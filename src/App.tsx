import './App.css';
import { bitable, FieldType, IFieldMeta, IOpenCellValue } from "@base-open/web-api";
import { Toast, Table } from '@douyinfe/semi-ui';
import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import Validator from 'fastest-validator';
import parse from 'parse-duration';

export default function App() {
  const [fieldsInfo, setFieldsInfo] = useState<IFieldMeta[]>([]);
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState<Array<{ recordId: string; columnName: string; cellVal: string; checkVal: string; time: string }>>([]);
  const [validationError, setValidationError] = useState<string | null>(null);
  const { t } = useTranslation();
  const recordModifyOffRef = useRef<(() => void) | null>(null);
  const debounceTimerRef = useRef<number | null>(null);
  const isTransforming = useRef(false);

  const getCellTextValue = (cellVal: IOpenCellValue): string => {
    if (!cellVal) return '';
    
    if (Array.isArray(cellVal)) {
      return cellVal.map((seg: any) => seg.text ?? '').join('');
    } else if (typeof cellVal === 'number') {
      return String(cellVal);
    } else if (typeof cellVal === 'string') {
      return cellVal;
    } else {
      return String(cellVal || '');
    }
  };

  const getTableMeta = async () => {
    setLoading(true);
    const selection = await bitable.base.getSelection();
    if (!selection?.tableId) {
      setLoading(false);
      setFieldsInfo([]);
      return [];
    }
    const table = await bitable.base.getTableById(selection.tableId);
    if (recordModifyOffRef.current) {
      recordModifyOffRef.current();
      recordModifyOffRef.current = null;
    }
    const off = table.onRecordModify((event) => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      debounceTimerRef.current = window.setTimeout(() => {
        handleTransform();
      }, 500);
    });
    recordModifyOffRef.current = off;
    const fieldMetaList = await table.getFieldMetaList();
    setLoading(false);
    if (!fieldMetaList) {
      setFieldsInfo([]);
      return [];
    }
    setFieldsInfo(fieldMetaList);
    return fieldMetaList;
  };

  useEffect(() => {
    const init = async () => {
      const fields = await getTableMeta();
      await handleTransform(fields);
    }

    const offSelectionChange = bitable.base.onSelectionChange(async () => {
      init();
    });
    
    init();
    
    return () => {
      offSelectionChange();
      if (recordModifyOffRef.current) {
        recordModifyOffRef.current();
      }
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  const onClickTransform = async (fields?: IFieldMeta[]) => {
    const fieldsToUse = fields || fieldsInfo;
    let transformNum = 0;
    console.log('开始验证，清空历史记录');
    setHistory([]);
    setValidationError(null);

    if (!fieldsToUse.length) return;

    const selection = await bitable.base.getSelection();
    if (!selection?.tableId || !selection?.viewId) {
      return;
    }
    const table = await bitable.base.getTableById(selection.tableId);
    const view = await table.getViewById(selection.viewId);
    const recordIds = await view.getVisibleRecordIdList();

    for (const fieldInfo of fieldsToUse) {
      if (!(fieldInfo as any).description) continue;
      const description = (fieldInfo as any).description;
      const comment = Array.isArray(description?.content) ? description.content : [];
      const validatorSeg = comment.find((item: any) => item.type === 'text' && item.text.includes('validator'));
      if (!validatorSeg) continue;
      let validatorObj: { validator?: string } = {};
      try {
        validatorObj = JSON.parse(validatorSeg.text.trim());
      } catch (err) {
        console.error('Validator JSON 解析失败:', err);
        continue;
      }

      if (!validatorObj.validator || typeof validatorObj.validator !== 'string' || !validatorObj.validator.trim()) continue;

      let exists_array: (string | number)[] = [];
      for (let idx = 0; idx < recordIds.length; idx++) {
        const recordId = recordIds[idx];
        let cellVal: IOpenCellValue = await table.getCellValue(fieldInfo.id, recordId!);
        if (!cellVal) {
          cellVal = [{
            type: 'text',
            text: ''
          }] as IOpenCellValue;
        };
        transformNum++;
        const cellText = getCellTextValue(cellVal);
        // 对于日期字段，收集原始数字值；对于其他字段，收集字符串值
        const collectValue = fieldInfo.type === 5 && typeof cellVal === 'number' ? cellVal : cellText;
        exists_array.push(collectValue);
      }

      const schema = { 
          [fieldInfo.name]: validatorObj.validator
      };
      console.log('创建验证器:', { 
        fieldName: fieldInfo.name, 
        fieldType: fieldInfo.type, 
        validator: validatorObj.validator, 
        schema 
      });
      const v = new Validator({
        useNewCustomCheckerFunction: true,
        messages: {
          stringExists: "当前列存在相同值",
          dateExpire: "已过期，需要进一步处理",
        },
      });
      const originalStringRule = v.rules.string;
      v.add("string", function (this: any, rule: any, path: any, context: any) {
        const result = originalStringRule.call(this, rule, path, context);
        if (rule.schema.exists === true) {
          const existsArrayString = JSON.stringify(exists_array);
          const existsValidation = `
            const existsArray = ${existsArrayString};
            const duplicateCount = existsArray.filter(item => item === value).length;
            if (duplicateCount > 1) {
              ${this.makeError({
                type: "stringExists",
                actual: "value",
                messages: rule.messages,
              })}
            }
          `;
          const lines = result.source.split("\n");
          const lastReturnIndex = lines
            .map((line: string, index: number) => (line.trim() === "return value;" ? index : -1))
            .filter((index: number) => index !== -1)
            .pop();
      
          if (lastReturnIndex !== undefined) {
            lines.splice(lastReturnIndex, 0, existsValidation);
            result.source = lines.join("\n");
          }
        }
      
        return result;
      });

      const originalDateRule = v.rules.date;
      v.add("date", function (this: any, rule: any, path: any, context: any) {
        const result = originalDateRule.call(this, rule, path, context);
        if (rule.schema.expire) {
          const expire = parse(rule.schema.expire!);
          if (expire !== null && expire !== undefined) {
            const expireValidation = `
              const dateTimestamp = value instanceof Date ? value.getTime() : new Date(value).getTime();
              const nowTimestamp = Date.now();
              const expireTimestamp = dateTimestamp + ${expire};
              if (isNaN(dateTimestamp)) {
                ${this.makeError({
                  type: "date",
                  actual: "value",
                  messages: rule.messages,
                })}
              } else if (nowTimestamp > expireTimestamp) {
                ${this.makeError({
                  type: "dateExpire",
                  actual: "value",
                  messages: rule.messages,
                })}
              }
            `;
            const lines = result.source.split("\n");
            const lastReturnIndex = lines
              .map((line: string, index: number) => (line.trim() === "return value;" ? index : -1))
              .filter((index: number) => index !== -1)
              .pop();
            if (lastReturnIndex !== undefined) {
              lines.splice(lastReturnIndex, 0, expireValidation);
              result.source = lines.join("\n");
            }
          }
        }
        return result;
      });

      let check;
      try {
        check = v.compile(schema);
      } catch (err: any) {
        console.error('Validator compile error:', err);
        const msg = t('invalid_validator_rule', { name: fieldInfo.name });
        setValidationError(msg);
        Toast.error(msg);
        continue;
      }

      for (let idx = 0; idx < recordIds.length; idx++) {
        const recordId = recordIds[idx];
        let checkPass = false;
        let cellVal: IOpenCellValue = await table.getCellValue(fieldInfo.id, recordId!);
        if (!cellVal) {
          // 伪造一个空对象 用于后续的check
          cellVal = [{
            type: 'text',
            text: ''
          }] as IOpenCellValue;
        };
        transformNum++;
        const cellText = getCellTextValue(cellVal);
        // 对于日期字段，使用原始数字值而不是字符串
        const checkValue = fieldInfo.type === 5 && typeof cellVal === 'number' ? cellVal : cellText;
        console.log('准备验证:', { 
          fieldName: fieldInfo.name, 
          fieldType: fieldInfo.type, 
          cellVal, 
          cellText, 
          checkValue,
          recordIdx: idx 
        });
        const checkResp = check({ [fieldInfo.name]: checkValue });
        console.log('验证结果 checkResp:', checkResp);
        if (checkResp === true) {
          checkPass = true;
          console.log('验证通过，跳过记录');
          continue;
        }
        
        let checkResult = '';
        if (Array.isArray(checkResp)) {
          checkResult = checkResp.map((item: any) => item.message).join(',');
        } else {
          checkResult = 'unknown';
        }
        console.log('处理错误结果:', { checkResult, checkResp });
        console.log('添加到历史记录:', {
          recordId: String(idx + 1),
          columnName: fieldInfo.name,
          cellVal: cellText,
          checkVal: checkResult,
        });
        setHistory(prev => {
          const newHistory = [
            ...prev,
            {
              recordId: String(idx + 1),
              columnName: fieldInfo.name,
              cellVal: cellText,
              checkVal: checkResult,
              time: new Date().toLocaleString(),
            },
          ];
          console.log('更新历史记录:', { prev, newHistory });
          return newHistory;
        });
      }
    }
    console.log('验证完成，处理了字段数量:', fieldsToUse.length);
  };

  const handleTransform = async (fields?: IFieldMeta[]) => {
    if (isTransforming.current) {
      return;
    }
    isTransforming.current = true;
    try {
      await onClickTransform(fields);
    } finally {
      isTransforming.current = false;
    }
  };

  console.log('组件渲染，当前 history 状态:', history);
  return (
    <div className={'container'}>
      {validationError && <p style={{ color: 'red', margin: '8px 0' }}>{validationError}</p>}
      {
        history.length ? (
          <Table
            className="compact-table"
            style={{ width: '100%', margin: 0 }}
            columns={[
              { title: t('history_column'), dataIndex: 'columnName', key: 'columnName', width: '20%' },
              { title: t('history_record'), dataIndex: 'recordId', key: 'recordId', width: '20%' },
              { title: t('history_oldVal'), dataIndex: 'cellVal', key: 'cellVal', width: '30%' },
              { title: t('history_newVal'), dataIndex: 'checkVal', key: 'checkVal', width: '30%' },
            ]}
            dataSource={history}
            pagination={false}
            size="small"
          />
        ) : (
          !validationError && <p style={{ margin: '8px 0' }}>{t('no_history')}</p>
        )
      }
    </div>
  )
}
import './App.css';
import {bitable, FieldType,IRecord,checkers, IGetRecordsResponse, IFieldMeta, IOpenCellValue } from "@lark-base-open/js-sdk"
import { Toast, Table } from '@douyinfe/semi-ui';
import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { createValidator } from './utils';

/**
 * 提取单元格的文本值
 * @param cellValue - 单元格值对象
 * @returns 单元格的文本表示
 */
// type IOpenCellValue = null | IOpenSingleSelect | IOpenMultiSelect | IOpenUser[] | IOpenTimestamp | IOpenNumber | IOpenCheckbox | IOpenAutoNumber | IOpenPhone | IOpenLocation | IOpenAttachment[] | IOpenSegment[] | IOpenUrlSegment$1[] | IOpenLink | IOpenGroupChat[] | IOpenFormulaCellValue;
// declare function isUsers(value: unknown): value is IOpenUser[];
// declare function isLocation(value: unknown): value is IOpenLocation;
// declare function isAttachment(value: unknown): value is IOpenAttachment;
// declare function isAttachments(value: unknown): value is IOpenAttachment[];
// declare function isTimestamp(value: unknown): value is IOpenTimestamp;
// declare function isCheckbox(value: unknown): value is IOpenCheckbox;
// declare function isPhone(value: unknown): value is IOpenPhone;
// declare function isAutoNumber(value: unknown): value is IOpenAutoNumber;
// declare function isNumber(value: unknown): value is IOpenNumber;
// declare function isSingleSelect(value: unknown): value is IOpenSingleSelect;
// declare function isMultiSelect(value: unknown): value is IOpenMultiSelect;
// declare function isEmpty(value: unknown): value is null;
// declare function isSegmentItem(value: unknown): value is IOpenSegment;
// declare function isSegments(value: unknown): value is IOpenSegment[];
// declare function isLink(value: unknown): value is IOpenLink;
// declare function isGroupChat(value: unknown): value is IOpenGroupChat;
// declare function isGroupChats(value: unknown): value is IOpenGroupChat[];


export function getCellTextValue(cellValue: IOpenCellValue): string {
  if (!cellValue) return "";

  let cellValue_text = ""
  let cellValue_type = ""

  if (checkers.isUsers(cellValue)) {
    cellValue_text = cellValue.map((item: any) => item.name).join(",");
    cellValue_type = "isUsers"
  } else if (checkers.isLink(cellValue)) {
    cellValue_text = "不支持当前类型的校验"
    cellValue_type = "isLink"
  } else if (checkers.isLocation(cellValue)) {
    cellValue_text = "不支持当前类型的校验"
    cellValue_type = "isLocation"
  } else if (checkers.isAttachment(cellValue)) {
    cellValue_text = "不支持当前类型的校验"
    cellValue_type = "isAttachment"
  } else if (checkers.isAttachments(cellValue)) {
    cellValue_text = cellValue.map((item: any) => item.name + item.size + item.timestamp).join(",");
    cellValue_type = "isAttachments"
  } else if (checkers.isTimestamp(cellValue)) {
    cellValue_text = String(cellValue); // 时间戳
    cellValue_type = "isTimestamp"
  } else if (checkers.isCheckbox(cellValue)) {
    cellValue_text = String(cellValue);
    cellValue_type = "isCheckbox"
  } else if (checkers.isPhone(cellValue)) {
    cellValue_text = "不支持当前类型的校验"
    cellValue_type = "isPhone"
  } else if (checkers.isAutoNumber(cellValue)) {
    cellValue_text = "不支持当前类型的校验"
    cellValue_type = "isAutoNumber"
  } else if (checkers.isNumber(cellValue)) {
    cellValue_text = "不支持当前类型的校验"
    cellValue_type = "isNumber"
  } else if (checkers.isSingleSelect(cellValue)) {
    cellValue_text = cellValue.text;
  } else if (checkers.isMultiSelect(cellValue)) {
    cellValue_text = cellValue.map((item: any) => item.text).join(",");
    cellValue_type = "isSingleSelect"
  } else if (checkers.isEmpty(cellValue)) {
    cellValue_text = "";
    cellValue_type = "isEmpty"
  } else if (checkers.isSegmentItem(cellValue)) {
    cellValue_text = "不支持当前类型的校验"
  } else if (checkers.isSegments(cellValue)) {
    cellValue_text = cellValue.map((item: any) => item.text).join(",");
    cellValue_type = "isSegments"
  }  else if (checkers.isGroupChat(cellValue)) {
    cellValue_text = "不支持当前类型的校验"
    cellValue_type = "isGroupChat"
  } else if (checkers.isGroupChats(cellValue)) {
    cellValue_text = cellValue.map((item: any) => item.id).join(",");
    cellValue_type = "isGroupChats"
  }

  return cellValue_text;
}

// 接口定义
interface ValidationHistoryRecord {
  recordId: string;
  columnName: string;
  cellValue: string;
  validationResult: string;
  timestamp: string;
}

interface ValidatorConfiguration {
  validator?: string;
}

// 优化后的记录数据结构
interface RecordData {
  recordId: string;
  fields: Record<string, string>;
}

// 验证器缓存
interface ValidatorCache {
  [fieldId: string]: {
    validator: any;
    config: ValidatorConfiguration;
  };
}

export default function App() {
  const [fieldsMetadata, setFieldsMetadata] = useState<IFieldMeta[]>([]);
  const [validationHistory, setValidationHistory] = useState<ValidationHistoryRecord[]>([]);
  const [validationError, setValidationError] = useState<string | null>(null);
  // 校验状态，用于在校验过程中给用户反馈
  const [isValidatingState, setIsValidatingState] = useState<boolean>(false);
  const { t } = useTranslation();
  const isValidating = useRef(false);
  
  // 缓存表格数据和验证器
  const recordsCache = useRef<RecordData[]>([]);
  const validatorsCache = useRef<ValidatorCache>({});
  const batchSize = 1000; // 每批处理的记录数

  const getTableMetadata = async () => {
    const selection = await bitable.base.getSelection();
    if (!selection?.tableId) {
      setFieldsMetadata([]);
      return [];
    }
    const table = await bitable.base.getTableById(selection.tableId);
    
    const fieldMetadataList = await table.getFieldMetaList();
    if (!fieldMetadataList) {
      setFieldsMetadata([]);
      return [];
    }
    setFieldsMetadata(fieldMetadataList);
    return fieldMetadataList;
  };

  const onListenValueChange = async () => {
    const table = await bitable.base.getActiveTable();

    // 注册监听并保存取消监听函数
    const offAdd = table.onRecordAdd(async (event: any) => {
      console.log("onRecordAdd");

      // 新增行记录 id
      const fields = await getTableMetadata();
      for (const recordId of event.data) {
        console.log("recordId: ", recordId);
        for (const field of fields) {
          try {
            const validatorConfig = extractValidatorConfig(field);
            if (!validatorConfig) continue;
  
            const validator = createValidator([]);
            const rule = validator.getRuleFromSchema(validatorConfig.validator!);
            if (!rule.schema.default) {
              continue;
            }
  
            console.log("设置的值为",field.name,recordId, field.id, String(rule.schema.default));


            // 获取cellvalue, 
            const cellValue = await table.getCellValue(recordId, field.id);
            console.log("cellValue", cellValue);

            const res = await table.setRecord(recordId,{
              fields: {
                [field.id]: String(rule.schema.default)
              }
            })
            console.log("res: ", res);
          } catch (error) {
            console.log("error: ", error);
          }
        }
      }
    });

    const offModify = table.onRecordModify(() => {
      console.log("onRecordModify");
    });

    const offDelete = table.onRecordDelete(() => {
      console.log("onRecordDelete");
    });

    // 返回取消监听函数
    return () => {
      offAdd?.();
      offModify?.();
      offDelete?.();
    };
  };

  useEffect(() => {
    const initialize = async () => {
      // 清空缓存
      recordsCache.current = [];
      validatorsCache.current = {};
      
      const fields = await getTableMetadata();
      try {
        console.log("开始验证数据",fields);
        await handleValidation(fields);
      } catch (error) {
        console.log("验证数据失败",error);
      }
    }

    initialize();

    // 保存取消监听函数
    let offValueChange: (() => void) | undefined;
    onListenValueChange().then((off) => {
      offValueChange = off;
    });

    const offSelectionChange = bitable.base.onSelectionChange(async () => {
      initialize();
    });

    return () => {
      offSelectionChange?.();
      offValueChange?.();
    };
  }, []);

  // 提取验证器配置的辅助函数
  const extractValidatorConfig = (fieldMetadata: IFieldMeta): ValidatorConfiguration | null => {
    if (!(fieldMetadata as any).description) return null;
    
    const description = (fieldMetadata as any).description;
    const comment = Array.isArray(description?.content) ? description.content : [];
    const validatorSegment = comment.find((item: any) => item.type === 'text' && item.text.includes('validator'));
    
    if (!validatorSegment) return null;
    
    try {
      const config = JSON.parse(validatorSegment.text.trim());
      if (!config.validator || typeof config.validator !== 'string' || !config.validator.trim()) {
        return null;
      }
      return config;
    } catch (error) {
      const errorMessage = t('invalid_validator_rule', { name: fieldMetadata.name });
      setValidationError(errorMessage);
      Toast.error(errorMessage);
      return null;
    }
  };

  // 优化后的批量获取数据函数
  const getCachedRecordsData = async (table: any): Promise<RecordData[]> => {
    if (recordsCache.current.length > 0) {
      return recordsCache.current;
    }

    console.log("开始获取表格数据");
    let records: IRecord[] = [];
    let pageToken: string | undefined = undefined;
    const pageSize = 5000;
    let res: IGetRecordsResponse | undefined = undefined;

    while (true) {
      if (pageToken) {
        res = await table.getRecords({ pageSize, pageToken });
      } else {
        res = await table.getRecords({ pageSize });
      }
      
      if (res) {
        records.push(...res.records);
      }
      
      if (!res || !res.hasMore) {
        break;
      }
      pageToken = res.pageToken;
    }

    console.log(`获取到 ${records.length} 条记录`);
    
    // 转换为优化的数据结构
    const processedRecords: RecordData[] = records.map(record => {
      const fields: Record<string, string> = {};
      for (const [fieldId, fieldValue] of Object.entries(record.fields)) {
        fields[fieldId] = getCellTextValue(fieldValue);
      }
      return {
        recordId: record.recordId,
        fields
      };
    });

    recordsCache.current = processedRecords;
    return processedRecords;
  };

  // 获取或创建验证器
  const getOrCreateValidator = (fieldMetadata: IFieldMeta, validatorConfig: ValidatorConfiguration, allValues: string[]): any => {
    const cacheKey = fieldMetadata.id;
    
    if (validatorsCache.current[cacheKey]) {
      return validatorsCache.current[cacheKey].validator;
    }

    const validationSchema = { [fieldMetadata.name]: validatorConfig.validator };
    const validator = createValidator(allValues);
    
    let compiledValidator;
    try {
      compiledValidator = validator.compile(validationSchema);
      validatorsCache.current[cacheKey] = {
        validator: compiledValidator,
        config: validatorConfig
      };
      return compiledValidator;
    } catch (error: any) {
      const errorMessage = t('invalid_validator_rule', { name: fieldMetadata.name });
      setValidationError(errorMessage);
      Toast.error(errorMessage);
      return null;
    }
  };

  // 分批处理验证
  const processBatchValidation = async (
    records: RecordData[],
    fieldMetadata: IFieldMeta,
    validator: any,
    startIndex: number,
    endIndex: number
  ): Promise<ValidationHistoryRecord[]> => {
    const batchResults: ValidationHistoryRecord[] = [];

    console.log("processBatchValidation", validator, endIndex);
    
    for (let i = startIndex; i < endIndex && i < records.length; i++) {
      const record = records[i];
      const cellValue = record.fields[fieldMetadata.id] || '';

      console.log("cellValue", cellValue);
      
      const validationResult = validator({ [fieldMetadata.name]: cellValue });
      
      if (validationResult !== true) {
        let validationMessage = '';
        if (Array.isArray(validationResult)) {
          validationMessage = validationResult.map((item: any) => item.message).join(',');
        } else {
          validationMessage = 'unknown';
        }
        
        batchResults.push({
          recordId: String(i + 1),
          columnName: fieldMetadata.name,
          cellValue: cellValue,
          validationResult: validationMessage,
          timestamp: new Date().toLocaleString(),
        });
      }
    }
    
    return batchResults;
  };

  // 验证单个字段的所有记录 - 优化版本
  const validateFieldRecords = async (
    records: RecordData[],
    fieldMetadata: IFieldMeta,
    validatorConfig: ValidatorConfiguration
  ): Promise<ValidationHistoryRecord[]> => {
    // 收集该字段的所有值
    const allValues = records.map(record => record.fields[fieldMetadata.id] || '');
    
    // 获取或创建验证器
    const validator = getOrCreateValidator(fieldMetadata, validatorConfig, allValues);
    if (!validator) {
      return [];
    }

    const allResults: ValidationHistoryRecord[] = [];
    
    // 分批处理数据
    for (let i = 0; i < records.length; i += batchSize) {
      const endIndex = Math.min(i + batchSize, records.length);
      
      // 使用异步处理避免阻塞UI
      const batchResults = await new Promise<ValidationHistoryRecord[]>((resolve) => {
        setTimeout(async () => {
          const results = await processBatchValidation(records, fieldMetadata, validator, i, endIndex);
          resolve(results);
        }, 0);
      });
      
      allResults.push(...batchResults);
      
      // 给UI一个更新的机会
      if (i > 0 && i % (batchSize * 5) === 0) {
        console.log(`已处理 ${i}/${records.length} 条记录`);
      }
    }
    
    return allResults;
  };

  const validateRecords = async (fields?: IFieldMeta[]) => {
    const fieldsToValidate = fields || fieldsMetadata;
    setValidationHistory([]);
    setValidationError(null);

    if (!fieldsToValidate.length) return;

    const selection = await bitable.base.getSelection();
    if (!selection?.tableId || !selection?.viewId) {
      return;
    }
    
    const table = await bitable.base.getTableById(selection.tableId);
    const view = await table.getViewById(selection.viewId);
    const allRecordIds = await view.getVisibleRecordIdList();
    const recordIds = allRecordIds.filter((id): id is string => id !== undefined);
    
    // 获取缓存的记录数据
    const allRecords = await getCachedRecordsData(table);

    // 使用 Map 加速查找并保持 allRecordIds 中的顺序
    const recordMap: Map<string, RecordData> = new Map();
    allRecords.forEach(record => {
      recordMap.set(record.recordId, record);
    });

    // 按照 allRecordIds 的顺序重新组装可见记录列表
    const visibleRecords: RecordData[] = recordIds
      .map(id => recordMap.get(id))
      .filter((record): record is RecordData => Boolean(record));
      
    const allValidationResults: ValidationHistoryRecord[] = [];
    
    // 并行验证多个字段
    const validationPromises = fieldsToValidate.map(async (fieldMetadata) => {
      const validatorConfig = extractValidatorConfig(fieldMetadata);
      if (!validatorConfig) return [];
      
      return await validateFieldRecords(visibleRecords, fieldMetadata, validatorConfig);
    });
    
    const results = await Promise.all(validationPromises);
    
    // 合并所有结果
    results.forEach(fieldResults => {
      allValidationResults.push(...fieldResults);
    });
    
    // 一次性更新UI
    setValidationHistory(allValidationResults);
    
    console.log(`校验结束，共发现 ${allValidationResults.length} 个问题`);
  };

  const handleValidation = async (fields?: IFieldMeta[]) => {
    if (isValidating.current) {
      console.log("正在验证中");
      return;
    }
    isValidating.current = true;
    // 触发 UI 更新，提示正在校验
    setIsValidatingState(true);
    try {
      await validateRecords(fields);
    } finally {
      isValidating.current = false;
      // 校验完成，取消提示
      setIsValidatingState(false);
    }
  };

  return (
    <div className={'container'}>
      {validationError && <p style={{ color: 'red', margin: '8px 0' }}>{validationError}</p>}
      {
        isValidatingState ? (
          <p style={{ margin: '8px 0' }}>{t('validating_table')}</p>
        ) : validationHistory.length ? (
          <Table
            className="compact-table"
            style={{ width: '100%', margin: 0 }}
            columns={[
              { title: t('history_column'), dataIndex: 'columnName', key: 'columnName', width: '20%' },
              { title: t('history_record'), dataIndex: 'recordId', key: 'recordId', width: '20%' },
              { title: t('history_oldVal'), dataIndex: 'cellValue', key: 'cellValue', width: '30%' },
              { title: t('history_newVal'), dataIndex: 'validationResult', key: 'validationResult', width: '30%' },
            ]}
            dataSource={validationHistory}
            pagination={false}
            size="small"
          />
        ) : (
          !validationError && <p style={{ margin: '8px 0', textAlign: 'center' }}>{t('no_history')}</p>
        )
      }
    </div>
  )
}
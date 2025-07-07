import './App.css';
import { bitable, FieldType, IOpenSegmentType, IFieldMeta } from "@base-open/web-api";
import { Select, Banner, Button, Toast } from '@douyinfe/semi-ui';
import { IconPlusCircle } from '@douyinfe/semi-icons';
import { useState, useEffect } from 'react';
import { capitalizeEnglishWords } from './utils';
import { useTranslation } from 'react-i18next';

export default function App() {
  const [fieldsInfo, setFieldsInfo] = useState<IFieldMeta[]>([]);
  const [loading, setLoading] = useState(false);
  const [fieldId, setFieldId] = useState<string | undefined>();
  const [buttonLoading, setButtonLoading] = useState(false);
  const { t } = useTranslation();


  const getTableMeta = async () => {
    setLoading(true);
    const selection = await bitable.base.getSelection();
    // Find current table by tableId
    const table = await bitable.base.getTableById(selection?.tableId!);
    // Get table's field meta list
    const fieldMetaList = await table.getFieldMetaList();
    setLoading(false);
    if (!fieldMetaList) return;
    setFieldsInfo(fieldMetaList.filter(val => val.type === FieldType.Text));
  };

  const getFieldInfo = (id: string) => {
    for (const field of fieldsInfo) {
      if (field.id === id) return field;
    }
    return;
  }

  useEffect(() => {
    bitable.base.onSelectionChange(() => {
      getTableMeta();
    })
  }, []);

  const onClickTransform = async () => {
    let transformNum = 0;
    if (!fieldId) return;
    const fieldInfo = getFieldInfo(fieldId);
    if (!fieldInfo) return;
    setButtonLoading(true);
    // 获取当前选取来获取对应的 table id 等，来获取对应 table
    const selection = await bitable.base.getSelection();
    const table = await bitable.base.getTableById(selection?.tableId!);
    // 获取所有的表格 id
    const recordIds = await table.getRecordIdList();
    for (const recordId of recordIds) {
      // 判断这条记录是否有进行转化的文本，以此实现转化记录数的统计
      let hasChange = false;
      const cellVal = await table.getCellValue(fieldId, recordId!);
      if (!cellVal) continue;
      const newCellVal = (cellVal as Array<{ type: string, text: string }>).map(val => {
        // 遇到文本内容就进行转化
        if (val.type === IOpenSegmentType.Text) {
          const newText = capitalizeEnglishWords(val.text);
          if (newText !== val.text) hasChange = true;
          return {
            type: IOpenSegmentType.Text,
            text: newText,
          }
        } else {
          return val;
        }
      });
      if (!hasChange) continue;
      transformNum++;
      const res = await table.setCellValue<Array<any>>(fieldId, recordId!, newCellVal);
      if (!res) {
        Toast.error(t('transform_fail', { 'transformNum': transformNum }));
        setButtonLoading(false);
        return;
      }
    }
    if (transformNum) {
      Toast.success(t('transform_success', {'transformNum': transformNum }));
    } else {
      Toast.warning(t('transform_warning', {'transformNum': transformNum }));
    }
    setButtonLoading(false);
  };

  useEffect(() => {
    // 在初始化页面时，进行字段信息的获取
    getTableMeta();
  }, []);

  return (
    <div className={'container'}>
      <div className='title'>
        <Banner
          fullMode={false}
          type="info"
          description={t('script_des')}
          closeIcon={null}
        />
      </div>
      <div className='field-title'>
        <Banner
          icon={<IconPlusCircle />}
          fullMode={false}
          type="success"
          description={t('select_field')}
          closeIcon={null}
        />
      </div>
      <Select
        style={{ width: '100%', maxWidth: '580' }}
        filter
        loading={loading}
        onDropdownVisibleChange={getTableMeta}
        onSearch={getTableMeta}
        onSelect={val => setFieldId(val as any)}
      >
        {
          fieldsInfo.map(val => {
            return <Select.Option value={val.id}>{val.name}</Select.Option>
          })
        }
      </Select>
      <Button
        loading={buttonLoading}
        disabled={!(fieldId)}
        theme='solid'
        type='primary'
        style={{ marginTop: 18 }}
        onClick={onClickTransform}
      >{t('transform')}</Button>
    </div>
  )
}
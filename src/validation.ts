import {
  IOpenCellValue,
  checkers,
  IFieldMeta,
  FieldType,
  IOpenSingleSelect,
} from "@lark-base-open/js-sdk";
import { createValidator } from "./utils";

/**
 * 提取单元格的文本值
 * @param cellValue - 单元格值对象
 * @returns 单元格的文本表示
 */
export function getCellTextValue(cellValue: IOpenCellValue): string {
  if (!cellValue) return "";

  let cellValue_text = "";
  let cellValue_type = "";

  // 首先处理最常见的纯字符串和数字类型
  if (typeof cellValue === "string") {
    cellValue_text = cellValue;
    cellValue_type = "string";
    return cellValue_text;
  }

  if (typeof cellValue === "number") {
    // 检查是否是时间戳（13位数字，大概是2001年之后的时间戳）
    if (cellValue > 1000000000000) {
      const date = new Date(cellValue);
      cellValue_text = date.toISOString();
      cellValue_type = "timestamp";
    } else {
      cellValue_text = String(cellValue);
      cellValue_type = "number";
    }
    return cellValue_text;
  }

  // 然后处理复杂的对象类型
  if (checkers.isUsers(cellValue)) {
    cellValue_text = cellValue.map((item: any) => item.name).join(",");
    cellValue_type = "isUsers";
  } else if (checkers.isLink(cellValue)) {
    cellValue_text = "不支持当前类型的校验";
    cellValue_type = "isLink";
  } else if (checkers.isLocation(cellValue)) {
    cellValue_text = "不支持当前类型的校验";
    cellValue_type = "isLocation";
  } else if (checkers.isAttachment(cellValue)) {
    cellValue_text = "不支持当前类型的校验";
    cellValue_type = "isAttachment";
  } else if (checkers.isAttachments(cellValue)) {
    cellValue_text = cellValue
      .map((item: any) => item.name + item.size + item.timestamp)
      .join(",");
    cellValue_type = "isAttachments";
  } else if (checkers.isTimestamp(cellValue)) {
    // 处理时间戳字段
    if (cellValue && typeof cellValue === "number") {
      // 如果是时间戳数字，转换为日期字符串
      const date = new Date(cellValue);
      cellValue_text = date.toISOString();
    } else {
      cellValue_text = String(cellValue);
    }
    cellValue_type = "isTimestamp";
  } else if (checkers.isCheckbox(cellValue)) {
    cellValue_text = String(cellValue);
    cellValue_type = "isCheckbox";
  } else if (checkers.isPhone(cellValue)) {
    cellValue_text = "不支持当前类型的校验";
    cellValue_type = "isPhone";
  } else if (checkers.isAutoNumber(cellValue)) {
    cellValue_text = "不支持当前类型的校验";
    cellValue_type = "isAutoNumber";
  } else if (checkers.isNumber(cellValue)) {
    cellValue_text = "不支持当前类型的校验";
    cellValue_type = "isNumber";
  } else if (checkers.isSingleSelect(cellValue)) {
    cellValue_text = cellValue.text;
  } else if (checkers.isMultiSelect(cellValue)) {
    cellValue_text = cellValue.map((item: any) => item.text).join(",");
    cellValue_type = "isSingleSelect";
  } else if (checkers.isEmpty(cellValue)) {
    cellValue_text = "";
    cellValue_type = "isEmpty";
  } else if (checkers.isSegmentItem(cellValue)) {
    cellValue_text = "不支持当前类型的校验";
  } else if (checkers.isSegments(cellValue)) {
    cellValue_text = cellValue.map((item: any) => item.text).join(",");
    cellValue_type = "isSegments";
  } else if (checkers.isGroupChat(cellValue)) {
    cellValue_text = "不支持当前类型的校验";
    cellValue_type = "isGroupChat";
  } else if (checkers.isGroupChats(cellValue)) {
    cellValue_text = cellValue.map((item: any) => item.id).join(",");
    cellValue_type = "isGroupChats";
  } else {
    // 处理其他情况
    cellValue_text = JSON.stringify(cellValue);
    cellValue_type = "object";
  }

  return cellValue_text;
}

/**
 * 根据字段类型和默认值创建正确的单元格值
 * @param fieldType - 字段类型
 * @param defaultValue - 默认值字符串
 * @param fieldMeta - 字段元数据（用于获取选项等）
 * @returns 正确格式的单元格值
 */
export const createCellValueByType = (
  fieldType: FieldType,
  defaultValue: string,
  fieldMeta?: IFieldMeta
): IOpenCellValue => {
  switch (fieldType) {
    case FieldType.Text:
      return defaultValue;

    case FieldType.Number:
      const numValue = parseFloat(defaultValue);
      return isNaN(numValue) ? 0 : numValue;

    case FieldType.SingleSelect:
      // 单选字段需要根据选项名称找到对应的选项ID
      if (fieldMeta && (fieldMeta as any).property?.options) {
        const options = (fieldMeta as any).property.options;
        const option = options.find((opt: any) => opt.name === defaultValue);

        const value: IOpenSingleSelect = {
          id: option.id,
          text: option.name,
        };
        return value;
      }
      // 如果找不到匹配的选项，返回null
      return null;
    default:
      // 其他不支持的类型返回null
      return null;
  }
};

// 接口定义
export interface ValidationHistoryRecord {
  recordId: string;
  columnName: string;
  cellValue: string;
  validationResult: string;
  timestamp: string;
  conflictRows?: number[]; // 冲突的行号数组
}

export interface ValidatorConfiguration {
  validator?: string;
}

/**
 * 提取验证器配置的辅助函数 - 适配飞书API格式
 * @param fieldMetadata - 字段元数据（飞书API格式）
 * @returns 验证器配置对象或null
 */
export const extractValidatorConfig = (
  fieldMetadata: any
): ValidatorConfiguration | null => {
  // 检查字段是否有description
  if (!fieldMetadata?.description) return null;

  const description = fieldMetadata.description;

  // 如果description是数组，查找包含validator的配置
  if (Array.isArray(description)) {
    const validatorSegment = description.find(
      (item: any) => item.text && item.text.includes("validator")
    );

    if (!validatorSegment) return null;

    try {
      const config = JSON.parse(validatorSegment.text.trim());
      if (
        !config.validator ||
        typeof config.validator !== "string" ||
        !config.validator.trim()
      ) {
        return null;
      }
      return config;
    } catch (error) {
      console.error("解析验证器配置失败:", error);
      return null;
    }
  }

  // 如果description是对象，查找content数组
  if (description && typeof description === "object" && description.content) {
    const comment = Array.isArray(description.content)
      ? description.content
      : [];
    const validatorSegment = comment.find(
      (item: any) => item.type === "text" && item.text.includes("validator")
    );

    if (!validatorSegment) return null;

    try {
      const config = JSON.parse(validatorSegment.text.trim());
      if (
        !config.validator ||
        typeof config.validator !== "string" ||
        !config.validator.trim()
      ) {
        return null;
      }
      return config;
    } catch (error) {
      console.error("解析验证器配置失败:", error);
      return null;
    }
  }

  return null;
};

/**
 * 验证单个字段的所有记录 - 适配飞书API数据格式
 * @param records - 记录数组（飞书API格式）
 * @param fieldMetadata - 字段元数据（飞书API格式）
 * @param validatorConfig - 验证器配置
 * @returns 验证结果数组
 */
export const validateFieldRecords = async (
  records: any[],
  fieldMetadata: any,
  validatorConfig: ValidatorConfiguration
): Promise<ValidationHistoryRecord[]> => {
  const results: ValidationHistoryRecord[] = [];

  console.log(`\n--- 开始验证字段 ${fieldMetadata.field_name} ---`);
  console.log(`记录总数: ${records.length}`);
  console.log(`验证配置: ${validatorConfig.validator}`);

  // 收集该字段的所有值和行号映射
  const allValues = records.map((record) => {
    // 尝试通过字段名称获取字段值，如果失败再尝试字段ID
    let fieldValue = record.fields?.[fieldMetadata.field_name];
    if (fieldValue === undefined) {
      fieldValue = record.fields?.[fieldMetadata.field_id];
    }
    return getCellTextValue(fieldValue);
  });

  console.log(`收集到的所有值:`, allValues);
  console.log(`非空值数量: ${allValues.filter((v) => v.trim() !== "").length}`);

  // 构建值到行号的映射（用于查找冲突行）
  const valueToRowsMap = new Map<string, number[]>();
  allValues.forEach((value, index) => {
    const trimmedValue = value.trim();
    if (trimmedValue !== "") {
      if (!valueToRowsMap.has(trimmedValue)) {
        valueToRowsMap.set(trimmedValue, []);
      }
      valueToRowsMap.get(trimmedValue)!.push(index + 1); // 行号从1开始
    }
  });

  console.log(`值到行号映射:`, Array.from(valueToRowsMap.entries()));

  // 创建验证器
  console.log(`正在创建验证器，传入 ${allValues.length} 个值...`);
  const validator = createValidator(allValues);
  const validationSchema: any = {
    [fieldMetadata.field_name]: validatorConfig.validator,
  };

  console.log(`验证模式:`, validationSchema);

  let compiledValidator;
  try {
    console.log(`正在编译验证器...`);
    compiledValidator = validator.compile(validationSchema);
    console.log(`验证器编译成功`);
  } catch (error) {
    console.error(
      `字段 ${fieldMetadata.field_name} 的验证规则编译失败:`,
      error
    );
    return results;
  }

  console.log(`开始逐一验证 ${records.length} 条记录...`);

  // 验证每条记录
  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    // 尝试通过字段名称获取字段值，如果失败再尝试字段ID
    let fieldValue = record.fields?.[fieldMetadata.field_name];
    if (fieldValue === undefined) {
      fieldValue = record.fields?.[fieldMetadata.field_id];
    }
    const cellValue = getCellTextValue(fieldValue);

    console.log(`验证记录 ${i + 1}: "${cellValue}"`);

    const validationResult = compiledValidator({
      [fieldMetadata.field_name]: cellValue,
    });

    console.log(`验证结果:`, validationResult);

    if (validationResult !== true) {
      let validationMessage = "";
      let conflictRows: number[] = [];

      if (Array.isArray(validationResult)) {
        validationMessage = validationResult
          .map((item: any) => item.message)
          .join(", ");

        // 如果是重复错误，查找冲突的行号
        if (validationMessage.includes("重复")) {
          const trimmedValue = cellValue.trim();
          if (trimmedValue !== "" && valueToRowsMap.has(trimmedValue)) {
            const allRowsWithValue = valueToRowsMap.get(trimmedValue)!;
            // 排除当前行，得到冲突行
            conflictRows = allRowsWithValue.filter((row) => row !== i + 1);

            // 只返回简单的"重复"，冲突信息通过 conflictRows 传递
            validationMessage = "重复";
          }
        }
      } else {
        validationMessage = "未知错误";
      }

      console.log(`发现验证错误: ${validationMessage}`);
      if (conflictRows.length > 0) {
        console.log(`冲突行号: ${conflictRows.join(", ")}`);
      }

      results.push({
        recordId: record.record_id || String(i + 1),
        columnName: fieldMetadata.field_name,
        cellValue: cellValue,
        validationResult: validationMessage,
        timestamp: new Date().toLocaleString(),
        conflictRows: conflictRows.length > 0 ? conflictRows : undefined,
      });
    }
  }

  console.log(
    `字段 ${fieldMetadata.field_name} 验证完成，发现 ${results.length} 个错误`
  );
  console.log(`--- 字段 ${fieldMetadata.field_name} 验证结束 ---\n`);

  return results;
};

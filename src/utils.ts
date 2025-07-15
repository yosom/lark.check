import Validator from "fastest-validator";
import parse from "parse-duration";

/**
 * 创建并配置验证器实例
 * @param existingValuesArray 现有值数组，用于唯一性验证
 * @returns 配置好的验证器实例
 */
export function createValidator(
  existingValuesArray: (string | number)[]
): Validator {
  console.log(`\n=== 创建验证器 ===`);
  console.log(`原始值数组长度: ${existingValuesArray.length}`);
  console.log(`原始值数组:`, existingValuesArray);

  const validator = new Validator({
    useNewCustomCheckerFunction: true,
    messages: {
      stringExists: "重复",
      dateExpire: "过期",
    },
  });

  // 扩展字符串验证规则，添加唯一性检查
  const originalStringRule = validator.rules.string;
  validator.add(
    "string",
    function (this: any, rule: any, path: any, context: any) {
      const result = originalStringRule.call(this, rule, path, context);
      if (rule.schema.exists === true) {
        console.log(`检测到 exists 规则，开始处理重复检查逻辑...`);

        // 移除existingValuesArray 中为trim后空字符串的值
        const filteredExistingValues = existingValuesArray.filter(
          (item: string | number) =>
            typeof item === "number" || item.trim() !== ""
        );

        console.log(`过滤后的值数组长度: ${filteredExistingValues.length}`);
        console.log(`过滤后的值数组:`, filteredExistingValues);

        // 统计重复值
        const valueCounts = filteredExistingValues.reduce((acc, item) => {
          acc[String(item)] = (acc[String(item)] || 0) + 1;
          return acc;
        }, {} as Record<string, number>);

        console.log(`值出现次数统计:`, valueCounts);

        const duplicates = Object.entries(valueCounts).filter(
          ([value, count]) => count > 1
        );
        console.log(`重复值:`, duplicates);

        console.log("existingValuesArray", filteredExistingValues);
        const existingValuesJson = JSON.stringify(filteredExistingValues);
        const existsValidation = `
        console.log('=== 执行重复检查 ===');
        console.log('检查的值:', value);
        const existsArray = ${existingValuesJson};
        console.log('对比数组:', existsArray);
        const duplicateCount = existsArray.filter(item => item === value).length;
        console.log('重复次数:', duplicateCount);
        if (duplicateCount > 1) {
          console.log('发现重复！');
          ${this.makeError({
            type: "stringExists",
            actual: "value",
            messages: rule.messages,
          })}
        } else {
          console.log('没有重复');
        }
        console.log('=== 重复检查完成 ===');
      `;
        const lines = result.source.split("\n");
        const lastReturnIndex = lines
          .map((line: string, index: number) =>
            line.trim() === "return value;" ? index : -1
          )
          .filter((index: number) => index !== -1)
          .pop();

        if (lastReturnIndex !== undefined) {
          lines.splice(lastReturnIndex, 0, existsValidation);
          result.source = lines.join("\n");
          console.log(`重复检查逻辑已注入到验证器中`);
        } else {
          console.log(`警告：未找到返回语句，重复检查逻辑注入失败`);
        }
      } else {
        console.log(`字段没有 exists 规则，跳过重复检查`);
      }

      return result;
    }
  );

  // 扩展日期验证规则，添加过期检查
  const originalDateRule = validator.rules.date;
  validator.add(
    "date",
    function (this: any, rule: any, path: any, context: any) {
      const result = originalDateRule.call(this, rule, path, context);

      // 处理convert规则 - 将时间戳字符串转换为日期对象
      if (rule.schema.convert) {
        const convertValidation = `
          // 处理convert规则 - 转换时间戳字符串为日期
          let convertedValue = value;
          if (typeof value === 'string' && value.match(/^\\d{13}$/)) {
            // 13位时间戳字符串
            convertedValue = new Date(parseInt(value));
          } else if (typeof value === 'string' && value.match(/^\\d{10}$/)) {
            // 10位时间戳字符串
            convertedValue = new Date(parseInt(value) * 1000);
          } else if (typeof value === 'string' && !isNaN(Date.parse(value))) {
            // 可解析的日期字符串
            convertedValue = new Date(value);
          } else if (typeof value === 'string' && value.match(/^\\d+$/)) {
            // 纯数字字符串，尝试作为时间戳
            const timestamp = parseInt(value);
            if (timestamp > 1000000000) {
              convertedValue = timestamp > 1000000000000 ? new Date(timestamp) : new Date(timestamp * 1000);
            }
          }
          
          // 验证转换后的日期是否有效
          if (!(convertedValue instanceof Date) || isNaN(convertedValue.getTime())) {
            ${this.makeError({
              type: "date",
              actual: "value",
              messages: rule.messages,
            })}
          }
          
          value = convertedValue;
        `;

        const lines = result.source.split("\n");
        const firstReturnIndex = lines.findIndex(
          (line: string) => line.trim() === "return value;"
        );
        if (firstReturnIndex !== -1) {
          lines.splice(firstReturnIndex, 0, convertValidation);
          result.source = lines.join("\n");
        }
      }

      if (rule.schema.expire) {
        const expireDuration = parse(rule.schema.expire!);
        if (expireDuration !== null && expireDuration !== undefined) {
          const expireValidation = `
          const dateTimestamp = value instanceof Date ? value.getTime() : new Date(value).getTime();
          const nowTimestamp = Date.now();
          const expireTimestamp = dateTimestamp + ${expireDuration};
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
            .map((line: string, index: number) =>
              line.trim() === "return value;" ? index : -1
            )
            .filter((index: number) => index !== -1)
            .pop();
          if (lastReturnIndex !== undefined) {
            lines.splice(lastReturnIndex, 0, expireValidation);
            result.source = lines.join("\n");
          }
        }
      }
      return result;
    }
  );

  console.log(`验证器创建完成`);
  console.log(`=== 验证器创建结束 ===\n`);

  return validator;
}

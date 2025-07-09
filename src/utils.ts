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
  const validator = new Validator({
    useNewCustomCheckerFunction: true,
    messages: {
      stringExists: "当前列存在相同值",
      dateExpire: "已过期，需要进一步处理",
    },
  });

  // 扩展字符串验证规则，添加唯一性检查
  const originalStringRule = validator.rules.string;
  validator.add(
    "string",
    function (this: any, rule: any, path: any, context: any) {
      const result = originalStringRule.call(this, rule, path, context);
      if (rule.schema.exists === true) {
        const existingValuesJson = JSON.stringify(existingValuesArray);
        const existsValidation = `
        const existsArray = ${existingValuesJson};
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
          .map((line: string, index: number) =>
            line.trim() === "return value;" ? index : -1
          )
          .filter((index: number) => index !== -1)
          .pop();

        if (lastReturnIndex !== undefined) {
          lines.splice(lastReturnIndex, 0, existsValidation);
          result.source = lines.join("\n");
        }
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

  return validator;
}

// 导入独立的验证模块中的校验函数
import { getCellTextValue, extractValidatorConfig, validateFieldRecords, ValidatorConfiguration, ValidationHistoryRecord } from './validation';
import lark from '@larksuiteoapi/node-sdk';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

// 定义接口类型
interface FeishuConfig {
    appId: string;
    appSecret: string;
    spreadsheetToken: string;
    sheetId: string;
}

interface UserFormData {
    name: string;
    phone: string;
    needs?: string;
}

interface FeishuTokenResponse {
    code: number;
    msg?: string;
    tenant_access_token?: string;
}

interface FeishuSheetResponse {
    code: number;
    msg?: string;
    data?: any;
}

interface FeishuWriteResponse {
    code: number;
    msg?: string;
    data?: any;
}

// 新增：飞书字段响应接口
interface FeishuFieldsResponse {
    code: number;
    msg?: string;
    data?: {
        items?: any[];
        page_token?: string;
        has_more?: boolean;
        total?: number;
    };
}

// 新增：列出字段的参数接口
interface FieldsParams {
    view_id?: string;
    text_field_as_array?: boolean;
    page_token?: string;
    page_size?: number;
}

// 新增：校验结果接口
interface ValidationResult {
    recordId: string;
    fieldName: string;
    cellValue: string;
    validationResult: string;
    timestamp: string;
    isValid: boolean;
    rowNumber?: number; // 添加行号字段
    conflictRows?: number[]; // 冲突的行号数组
}

// 新增：按用户分组的错误接口
interface UserValidationError {
    recordId: string;
    fieldName: string;
    cellValue: string;
    validationResult: string;
    timestamp: string;
    rowNumber?: number; // 添加行号字段
    conflictRows?: number[]; // 冲突的行号数组
}

interface GroupedValidationErrors {
    [userId: string]: UserValidationError[];
}

// 新增：通知记录接口
interface NotificationRecord {
    spreadsheetToken: string;
    sheetId: string;
    recordId: string;
    fieldName: string;
    validationResult: string;
    modifiedTime: string;
    notifiedAt: string;
}

// 通知记录管理函数
const NOTIFICATION_DIR = 'notifications';

// 确保通知目录存在
function ensureNotificationDir(): void {
    if (!fs.existsSync(NOTIFICATION_DIR)) {
        fs.mkdirSync(NOTIFICATION_DIR, { recursive: true });
    }
}

// 生成通知文件名（table.行.hash格式，人类可读）
function generateNotificationFileName(
    spreadsheetToken: string,
    sheetId: string,
    recordId: string,
    modifiedTime: string,
    rowNumber?: number
): string {
    const content = `${spreadsheetToken}_${sheetId}_${recordId}_${modifiedTime}`;
    const hash = crypto.createHash('md5').update(content).digest('hex').substring(0, 8); // 使用8位哈希即可
    
    // 截取sheetId的前8位作为table标识
    const tableId = sheetId.substring(0, 8);
    
    // 如果有行号，使用行号；否则使用recordId前8位
    const rowIdentifier = rowNumber ? `${rowNumber}` : recordId.substring(0, 8);
    
    return `${tableId}.${rowIdentifier}.${hash}.notified`;
}

// 检查是否已经通知过
function hasBeenNotified(
    spreadsheetToken: string,
    sheetId: string,
    recordId: string,
    modifiedTime: string,
    rowNumber?: number
): boolean {
    try {
        ensureNotificationDir();
        const fileName = generateNotificationFileName(
            spreadsheetToken,
            sheetId,
            recordId,
            modifiedTime,
            rowNumber
        );
        const filePath = path.join(NOTIFICATION_DIR, fileName);
        return fs.existsSync(filePath);
    } catch (error) {
        console.error('检查通知记录时出错:', error);
        return false;
    }
}

// 记录通知
function recordNotification(
    spreadsheetToken: string,
    sheetId: string,
    recordId: string,
    modifiedTime: string,
    rowNumber?: number
): void {
    try {
        ensureNotificationDir();
        const fileName = generateNotificationFileName(
            spreadsheetToken,
            sheetId,
            recordId,
            modifiedTime,
            rowNumber
        );
        const filePath = path.join(NOTIFICATION_DIR, fileName);
        
        const notificationRecord: NotificationRecord = {
            spreadsheetToken,
            sheetId,
            recordId,
            fieldName: '', // 简化后不再需要具体字段
            validationResult: '', // 简化后不再需要具体验证结果
            modifiedTime,
            notifiedAt: new Date().toISOString()
        };
        
        fs.writeFileSync(filePath, JSON.stringify(notificationRecord, null, 2));
        console.log(`已记录通知: ${fileName}`);
    } catch (error) {
        console.error('记录通知时出错:', error);
    }
}

// 获取飞书访问令牌
async function getFeishuToken(config: FeishuConfig): Promise<string> {
    try {
        const response = await fetch('https://open.larksuite.com/open-apis/auth/v3/tenant_access_token/internal/', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                app_id: config.appId,
                app_secret: config.appSecret
            })
        });

        const data: FeishuTokenResponse = await response.json();

        if (data.code !== 0) {
            throw new Error(`Failed to get Feishu token: ${data.msg}`);
        }

        return data.tenant_access_token!;
    } catch (error) {
        console.error('Error getting Feishu token:', error);
        throw error;
    }
}

async function getFeishuSheet(token: string, config: FeishuConfig, page_token: string, page_size: number): Promise<FeishuSheetResponse> {
    // 构建查询参数
    const params = new URLSearchParams();
    if (page_token) {
        params.append('page_token', page_token);
    }
    if (page_size) {
        params.append('page_size', page_size.toString());
    }
    
    const url = `https://open.larksuite.com/open-apis/bitable/v1/apps/${config.spreadsheetToken}/tables/${config.sheetId}/records?${params.toString()}`;
    
    const response = await fetch(url, {
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json; charset=utf-8'
        }
    });

    const data: FeishuSheetResponse = await response.json();
    console.log(data);

    return data;
}

// 列出字段函数
// 根据 app_token 和 table_id，获取数据表的所有字段
async function getFeishuFields(token: string, config: FeishuConfig, params?: FieldsParams): Promise<FeishuFieldsResponse> {
    try {
        // 构建查询参数
        const queryParams = new URLSearchParams();
        
        if (params?.view_id) {
            queryParams.append('view_id', params.view_id);
        }
        if (params?.text_field_as_array !== undefined) {
            queryParams.append('text_field_as_array', params.text_field_as_array.toString());
        }
        if (params?.page_token) {
            queryParams.append('page_token', params.page_token);
        }
        if (params?.page_size) {
            queryParams.append('page_size', params.page_size.toString());
        }
        
        // 构建URL
        const url = `https://open.larksuite.com/open-apis/bitable/v1/apps/${config.spreadsheetToken}/tables/${config.sheetId}/fields${queryParams.toString() ? '?' + queryParams.toString() : ''}`;
        
        // 发送请求
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json; charset=utf-8'
            }
        });

        const data: FeishuFieldsResponse = await response.json();
        console.log('获取字段数据:', data);

        if (data.code !== 0) {
            throw new Error(`Failed to get Feishu fields: ${data.msg}`);
        }

        // https://open.larksuite.com/open-apis/bot/v2/hook/2ed0c4cf-b2cb-4037-89ec-7d0b449a6c72

        return data;
    } catch (error) {
        console.error('Error getting Feishu fields:', error);
        throw error;
    }
}


// 将数据写入飞书表格
async function writeToFeishuSheet(token: string, config: FeishuConfig, formData: UserFormData): Promise<FeishuWriteResponse> {
    try {
        // 多维表格API端点
        const url = `https://open.larksuite.com/open-apis/bitable/v1/apps/${config.spreadsheetToken}/tables/${config.sheetId}/records`;

        // 构建多维表格请求体
        const requestData = {
            fields: {
                "日期": null,
                "姓名": formData.name,
                "电话": formData.phone,
                "需求": formData.needs || "",
            }
        };

        // 发送请求
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify(requestData)
        });

        const data: FeishuWriteResponse = await response.json();
        console.log(data);

        if (data.code !== 0) {
            throw new Error(`Failed to write to Feishu sheet: ${data.msg}`);
        }

        return data;
    } catch (error) {
        console.error('Error writing to Feishu sheet:', error);
        throw error;
    }
}

// 新增：发送合并的校验消息给用户
async function sendMergedValidationMessage(user_id: string, errors: UserValidationError[], tableName?: string, spreadsheetToken?: string, sheetId?: string): Promise<void> {
    try {
        // 构建错误内容
        const errorContent = [];

    //     {
    //         "tag": "a",
    //         "text": "请查看",
    //         "href": "http://www.example.com/"
    // },
        
        // 添加表名（蓝色链接格式）
        if (tableName && spreadsheetToken && sheetId) {
            const tableUrl = `https://njpv9jq9m6vi.jp.larksuite.com/base/${spreadsheetToken}?table=${sheetId}`;
            errorContent.push([{
                "tag": "a",
                "text": `表链接`,
                "href": tableUrl
            }]);
        } else if (tableName) {
            errorContent.push([{
                "tag": "text",
                "text": `表${tableName}\n`
            }]);
        }
        
        // 按问题类型（validationResult）分组相同的错误
        const groupedByProblem: {[problemType: string]: UserValidationError[]} = {};
        errors.forEach(error => {
            const problemType = error.validationResult;
            if (!groupedByProblem[problemType]) {
                groupedByProblem[problemType] = [];
            }
            groupedByProblem[problemType].push(error);
        });
        
        // 为每个问题类型生成简洁格式
        Object.entries(groupedByProblem).forEach(([problemType, problemErrors]) => {
            // 按字段分组，获取每个字段的行号
            const fieldGroups: {[fieldName: string]: number[]} = {};
            
            problemErrors.forEach(error => {
                if (!fieldGroups[error.fieldName]) {
                    fieldGroups[error.fieldName] = [];
                }
                if (error.rowNumber) {
                    fieldGroups[error.fieldName].push(error.rowNumber);
                }
            });
            
            // 对每个字段的行号排序并去重
            Object.values(fieldGroups).forEach(rowNumbers => {
                rowNumbers.sort((a, b) => a - b);
            });
            
            // 为每个字段生成消息行
            Object.entries(fieldGroups).forEach(([fieldName, rowNumbers]) => {
                const uniqueRows = [...new Set(rowNumbers)];
                
                // 检查这个字段是否有冲突行号信息
                const errorsForField = problemErrors.filter(error => error.fieldName === fieldName);
                let allRelatedRows = new Set<number>(uniqueRows);
                
                // 如果是重复错误，合并当前行和冲突行
                if (problemType.includes('重复') && errorsForField.length > 0) {
                    errorsForField.forEach(error => {
                        if (error.conflictRows) {
                            error.conflictRows.forEach(row => allRelatedRows.add(row));
                        }
                    });
                }
                
                const sortedRows = Array.from(allRelatedRows).sort((a, b) => a - b);
                const rowText = sortedRows.join(',') + '行';
                
                errorContent.push([{
                    "tag": "text",
                    "text": `${problemType}: "${fieldName}" [${rowText}]`
                }]);
            });
        });
        
        // 添加结尾
        errorContent.push([{
            "tag": "text",
            "text": "\n请及时修正，谢谢！ "
        }, {
            "tag": "at",
            "user_id": user_id
        }]);

        const response = await fetch('https://open.larksuite.com/open-apis/bot/v2/hook/2ed0c4cf-b2cb-4037-89ec-7d0b449a6c72', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                "msg_type": "post",
                "content": {
                    "post": {
                        "zh_cn": {
                            "title": "数据校验问题通知",
                            "content": errorContent
                        }
                    }
                }
            })
        });
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        console.log(`已发送合并校验消息给用户 ${user_id}，原有 ${errors.length} 个错误，合并后 ${Object.keys(groupedByProblem).length} 个问题类型`);
        
    } catch (error) {
        console.error('发送合并消息失败:', error);
        throw error;
    }
}

// 保留原来的单个错误发送函数（备用）
async function sendValidationMessage(user_id: string, fieldName: string, cellValue: string, validationResult: string) {
    try {
        const response = await fetch('https://open.larksuite.com/open-apis/bot/v2/hook/2ed0c4cf-b2cb-4037-89ec-7d0b449a6c72', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                "msg_type": "post",
                "content": {
                    "post": {
                        "zh_cn": {
                            "title": "数据校验问题通知",
                            "content": [
                                [{
                                    "tag": "text",
                                    "text": "您的数据需要修正："
                                }],
                                [{
                                    "tag": "text",
                                    "text": `字段: ${fieldName}\n`
                                }],
                                [{
                                    "tag": "text",
                                    "text": `值: ${cellValue}\n`
                                }],
                                [{
                                    "tag": "text",
                                    "text": `问题: ${validationResult}\n`
                                }],
                                [{
                                    "tag": "text",
                                    "text": "请及时修正，谢谢！ "
                                },
                                {
                                    "tag": "at",
                                    "user_id": user_id
                                }]
                            ]
                        }
                    }
                }
            })
        });
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        console.log(`已发送校验消息给用户 ${user_id}`);
        return response;
    } catch (error) {
        console.error('发送消息失败:', error);
        throw error;
    }
}

// 新增：使用 Lark SDK 获取文档内容
const client = new lark.Client({
    appId: 'cli_a8e91ed525f8502d',
    appSecret: 'iykFwwo19mBbfB6hlUUTChes80KBh6TK',
    disableTokenCache: false
});

// 新增：获取多维表格记录（参考 mini.tsx 的方式）
async function getFeishuRecordsWithIterator(
    config: FeishuConfig,
    token: string
): Promise<any[]> {
    try {
        const records = [];
        
        // 使用迭代器的方式便捷的获取数据，无需手动维护page_token
        if (token.startsWith('u-')) {
            for await (const item of await client.bitable.appTableRecord.listWithIterator({
                path: {
                    app_token: config.spreadsheetToken,
                    table_id: config.sheetId,
                },
                params: {
                    text_field_as_array: true,
                    user_id_type: 'open_id',
                    display_formula_ref: true,
                    automatic_fields: true,
                    page_size: 100,
                },
            },
            // 判断token前缀,如果u开头,则使用user_access_token
            // 否则使用tenant_access_token
            lark.withUserAccessToken(token)
            )) {
                records.push(...(item?.items || []));
            }
        } else {
            for await (const item of await client.bitable.appTableRecord.listWithIterator({
                path: {
                    app_token: config.spreadsheetToken,
                    table_id: config.sheetId,
                },
                params: {
                    text_field_as_array: true,
                    user_id_type: 'open_id',
                    display_formula_ref: true,
                    automatic_fields: true,
                    page_size: 100,
                },
            },
            // 判断token前缀,如果u开头,则使用user_access_token
            // 否则使用tenant_access_token
            lark.withTenantToken(token)
            )) {
                records.push(...(item?.items || []));
            }
        }
        
        
        console.log(`通过迭代器获取到 ${records.length} 条记录`);
        return records;
    } catch (error) {
        console.error('使用迭代器获取记录失败:', error);
        throw error;
    }
}

// 修改：校验飞书表格数据并发送消息
async function validateFeishuData(
    token: string,
    config: FeishuConfig
): Promise<ValidationResult[]> {
    try {
        console.log('开始校验飞书表格数据...');
        
        // 获取字段信息
        const fieldsData = await getFeishuFields(token, config, {
            page_size: 100,
            text_field_as_array: true
        });
        
        if (fieldsData.code !== 0 || !fieldsData.data?.items) {
            console.error('获取字段信息失败:', fieldsData.msg);
            return [];
        }
        
        // 使用迭代器方式获取记录数据
        const all_records = await getFeishuRecordsWithIterator(config, token);
        
        console.log(`共获取到 ${all_records.length} 条记录`);
        
        // 对每个有验证配置的字段进行校验
        const allValidationResults: ValidationResult[] = [];
        const groupedErrors: GroupedValidationErrors = {};
        
        for (const field of fieldsData.data.items) {
            console.log(`\n========== 开始处理字段: ${field.field_name} ==========`);
            console.log(`字段ID: ${field.field_id}`);
            console.log(`字段类型: ${field.type}`);
            
            const validatorConfig = extractValidatorConfig(field);
            if (!validatorConfig) {
                console.log(`字段 ${field.field_name} 没有验证配置，跳过`);
                continue;
            }
            
            console.log(`字段 ${field.field_name} 的验证配置:`, validatorConfig);
            
            // 收集该字段的所有值用于调试
            const allFieldValues = all_records.map((record, index) => {
                let fieldValue = record.fields?.[field.field_name];
                if (fieldValue === undefined) {
                    fieldValue = record.fields?.[field.field_id];
                }
                const textValue = getCellTextValue(fieldValue);
                console.log(`记录 ${index + 1} (${record.record_id?.substring(0, 8)}...): "${textValue}"`);
                return textValue;
            });
            
            console.log(`字段 ${field.field_name} 的所有值:`, allFieldValues);
            
            // 检查是否有重复值
            const duplicateValues = allFieldValues.filter((value, index) => 
                allFieldValues.indexOf(value) !== index && value.trim() !== ""
            );
            console.log(`检测到的重复值:`, [...new Set(duplicateValues)]);
            
            // 统计每个值的出现次数
            const valueCounts = allFieldValues.reduce((acc, value) => {
                if (value.trim() !== "") {
                    acc[value] = (acc[value] || 0) + 1;
                }
                return acc;
            }, {} as Record<string, number>);
            
            console.log(`值出现次数统计:`, valueCounts);
            
            // 找出出现次数大于1的值
            const duplicateStats = Object.entries(valueCounts).filter(([value, count]) => count > 1);
            console.log(`重复值统计:`, duplicateStats);
            
            console.log(`正在校验字段: ${field.field_name}`);
            const fieldResults = await validateFieldRecords(all_records, field, validatorConfig);
            
            console.log(`字段 ${field.field_name} 校验完成，发现 ${fieldResults.length} 个问题`);
            
            if (fieldResults.length > 0) {
                console.log(`字段 ${field.field_name} 的校验结果:`, fieldResults);
            }
            
            // 转换 ValidationHistoryRecord 到 ValidationResult
            const convertedResults = fieldResults.map(result => {
                // 找到对应记录的索引作为行号
                const recordIndex = all_records.findIndex(r => r.record_id === result.recordId);
                return {
                    recordId: result.recordId,
                    fieldName: result.columnName,
                    cellValue: result.cellValue,
                    validationResult: result.validationResult,
                    timestamp: result.timestamp,
                    isValid: false,
                    rowNumber: recordIndex >= 0 ? recordIndex + 1 : undefined, // 行号从1开始
                    conflictRows: result.conflictRows // 传递冲突行号
                };
            });
            
            allValidationResults.push(...convertedResults);
            
            // 按记录ID分组，以记录为单位进行通知检查
            const recordErrorsMap = new Map<string, ValidationResult[]>();
            
            for (const result of convertedResults) {
                if (!recordErrorsMap.has(result.recordId)) {
                    recordErrorsMap.set(result.recordId, []);
                }
                recordErrorsMap.get(result.recordId)!.push(result);
            }
            
            // 为每个有错误的记录检查是否需要通知
            for (const [recordId, recordErrors] of recordErrorsMap) {
                // 查找对应的记录，获取修改者信息
                const record = all_records.find(r => r.record_id === recordId);
                
                if (record && record.last_modified_by?.id) {
                    try {
                        // 检查是否已经通知过此记录
                        const modifiedTime = record.last_modified_time || '';
                        const recordIndex = all_records.findIndex(r => r.record_id === recordId);
                        const rowNumber = recordIndex >= 0 ? recordIndex + 1 : undefined;
                        
                        const alreadyNotified = hasBeenNotified(
                            config.spreadsheetToken,
                            config.sheetId,
                            recordId,
                            modifiedTime,
                            rowNumber
                        );
                        
                        if (alreadyNotified) {
                            console.log(`跳过已通知的记录: ${recordId} 第${rowNumber}行 (修改时间: ${modifiedTime})`);
                            continue;
                        }
                        
                        // 将该记录的所有错误添加到按用户分组的错误列表中
                        if (!groupedErrors[record.last_modified_by.id]) {
                            groupedErrors[record.last_modified_by.id] = [];
                        }
                        
                        for (const result of recordErrors) {
                            groupedErrors[record.last_modified_by.id].push({
                                recordId: result.recordId,
                                fieldName: result.fieldName,
                                cellValue: result.cellValue,
                                validationResult: result.validationResult,
                                timestamp: result.timestamp,
                                rowNumber: result.rowNumber, // 使用已计算的行号
                                conflictRows: result.conflictRows // 传递冲突行号
                            });
                        }
                        
                        console.log(`记录 ${recordId} 有 ${recordErrors.length} 个错误，已添加到用户 ${record.last_modified_by.id} 的通知列表`);
                    } catch (error) {
                        console.error(`记录 ${recordId} 的错误信息处理失败:`, error);
                    }
                }
            }
            
            console.log(`========== 字段 ${field.field_name} 处理完成 ==========\n`);
        }
        
        console.log(`校验完成，共发现 ${allValidationResults.length} 个问题`);
        
        // 统计需要通知的错误数量
        const totalErrorsToNotify = Object.values(groupedErrors).reduce((sum, errors) => sum + errors.length, 0);
        console.log(`需要通知的错误数量: ${totalErrorsToNotify}`);
        
        // 输出校验结果
        if (allValidationResults.length > 0) {
            console.log('校验结果详情:');
            allValidationResults.forEach((result, index) => {
                const rowInfo = result.rowNumber ? `第 ${result.rowNumber} 行` : result.recordId.substring(0, 8);
                const conflictInfo = result.conflictRows && result.conflictRows.length > 0 
                    ? ` (与第${result.conflictRows.join(', ')}行冲突)` 
                    : '';
                console.log(`${index + 1}. ${rowInfo} - 记录ID: ${result.recordId}`);
                console.log(`   字段: ${result.fieldName}`);
                console.log(`   值: ${result.cellValue}`);
                console.log(`   错误: ${result.validationResult}${conflictInfo}`);
                console.log(`   时间: ${result.timestamp}`);
                console.log('---');
            });
        } else {
            console.log('🎉 所有数据都通过了校验！');
        }
        
        // 输出需要通知的错误分组
        console.log('\n需要通知的错误分组:');
        Object.entries(groupedErrors).forEach(([userId, errors]) => {
            console.log(`用户 ${userId}: ${errors.length} 个错误`);
            errors.forEach((error, index) => {
                const conflictInfo = error.conflictRows && error.conflictRows.length > 0 
                    ? ` (与第${error.conflictRows.join(', ')}行冲突)` 
                    : '';
                console.log(`  ${index + 1}. 记录 ${error.recordId} - ${error.fieldName}: ${error.validationResult}${conflictInfo}`);
            });
        });
        
        // 只向最后修改的用户发送消息
        if (Object.keys(groupedErrors).length > 0) {
            // 找到最后修改时间最晚的用户
            let latestModifiedUser = null;
            let latestModifiedTime = 0;
            let allErrorsForLatestUser: UserValidationError[] = [];
            
            // 遍历所有有错误的记录，找到最晚修改时间
            for (const result of allValidationResults) {
                const record = all_records.find(r => r.record_id === result.recordId);
                if (record && record.last_modified_by?.id && record.last_modified_time) {
                    const modifiedTime = parseInt(record.last_modified_time);
                    if (modifiedTime > latestModifiedTime) {
                        latestModifiedTime = modifiedTime;
                        latestModifiedUser = record.last_modified_by.id;
                    }
                }
            }
            
            // 如果找到了最后修改的用户，收集所有错误发送给他
            if (latestModifiedUser) {
                console.log(`找到最后修改的用户: ${latestModifiedUser}，修改时间: ${new Date(latestModifiedTime).toLocaleString()}`);
                
                // 收集所有需要通知的错误（只包含未通知过的记录的错误）
                allErrorsForLatestUser = [];
                for (const userId in groupedErrors) {
                    if (groupedErrors.hasOwnProperty(userId)) {
                        allErrorsForLatestUser.push(...groupedErrors[userId]);
                    }
                }
                
                console.log(`正在向最后修改的用户 ${latestModifiedUser} 发送消息，包含 ${allErrorsForLatestUser.length} 个错误`);
                
                try {
                    await sendMergedValidationMessage(latestModifiedUser, allErrorsForLatestUser, "数据校验表", config.spreadsheetToken, config.sheetId);
                    
                    // 记录已发送的通知
                    const recordedNotifications = new Set<string>();
                    for (const error of allErrorsForLatestUser) {
                        const record = all_records.find(r => r.record_id === error.recordId);
                        if (record && record.last_modified_time) {
                            const notificationKey = `${error.recordId}_${record.last_modified_time}`;
                            if (!recordedNotifications.has(notificationKey)) {
                                recordNotification(
                                    config.spreadsheetToken,
                                    config.sheetId,
                                    error.recordId,
                                    record.last_modified_time,
                                    error.rowNumber
                                );
                                recordedNotifications.add(notificationKey);
                            }
                        }
                    }
                    
                    console.log(`已记录 ${allErrorsForLatestUser.length} 个错误的通知`);
                } catch (error) {
                    console.error(`向最后修改的用户 ${latestModifiedUser} 发送消息失败:`, error);
                }
            } else {
                console.log('无法确定最后修改的用户，按原逻辑发送消息');
                // 回退到原逻辑
                for (const userId in groupedErrors) {
                    if (groupedErrors.hasOwnProperty(userId)) {
                        const userErrors = groupedErrors[userId];
                        console.log(`正在向用户 ${userId} 发送合并消息，包含 ${userErrors.length} 个错误`);
                        
                        try {
                            await sendMergedValidationMessage(userId, userErrors, "数据校验表", config.spreadsheetToken, config.sheetId);
                            
                            // 记录已发送的通知
                            const recordedNotifications = new Set<string>();
                            for (const error of userErrors) {
                                const record = all_records.find(r => r.record_id === error.recordId);
                                if (record && record.last_modified_time) {
                                    const notificationKey = `${error.recordId}_${record.last_modified_time}`;
                                    if (!recordedNotifications.has(notificationKey)) {
                                        recordNotification(
                                            config.spreadsheetToken,
                                            config.sheetId,
                                            error.recordId,
                                            record.last_modified_time,
                                            error.rowNumber
                                        );
                                        recordedNotifications.add(notificationKey);
                                    }
                                }
                            }
                            
                            console.log(`已记录用户 ${userId} 的 ${userErrors.length} 个错误的通知`);
                            
                            // 添加延迟避免频繁发送
                            await new Promise(resolve => setTimeout(resolve, 1000));
                        } catch (error) {
                            console.error(`向用户 ${userId} 发送合并消息失败:`, error);
                        }
                    }
                }
            }
        }
        
        return allValidationResults;
        
    } catch (error) {
        console.error('校验过程中发生错误:', error);
        return [];
    }
}

// 主函数 - 演示数据插入和校验
async function validate(feishuConfig: FeishuConfig, token: string): Promise<void> {
    try {
        console.log('配置信息:', feishuConfig);

        // 检查配置是否完整
        const missingConfigs = Object.entries(feishuConfig)
            .filter(([_, value]) => !value)
            .map(([key]) => key);

        if (missingConfigs.length > 0) {
            console.error(`缺少飞书API配置: ${missingConfigs.join(', ')}. 请提供API凭据。`);
            return;
        }
    
        console.log('获取到token:', token);
        console.log('------------------------');
        
        // 获取字段信息
        console.log('正在获取字段信息...');
        const fieldsData = await getFeishuFields(token, feishuConfig, {
            page_size: 100,
            text_field_as_array: true
        });
        console.log('字段信息:', fieldsData);
        console.log('字段数量:', fieldsData.data?.items?.length || 0);
        
        // 显示字段详情
        if (fieldsData.data?.items) {
            console.log('字段详情:');
            fieldsData.data.items.forEach((field, index) => {
                console.log(`${index + 1}. ${field.field_name} (${field.type})`);
                console.log(field.description);
            });
        }
        console.log('------------------------');
        
        // 调用校验逻辑
        console.log('开始调用校验逻辑...');
        const validationResults = await validateFeishuData(token, feishuConfig);
        
        console.log('------------------------');
        console.log('校验汇总:');
        console.log(`总共校验了 ${validationResults.length} 个问题`);
        
        if (validationResults.length > 0) {
            console.log('需要修正的问题:');
            validationResults.forEach((result, index) => {
                console.log(`${index + 1}. ${result.fieldName}: ${result.validationResult}`);
            });
        } else {
            console.log('✅ 所有数据校验通过！');
        }
        
        console.log('数据处理完成！');
        
    } catch (error) {
        console.error('处理表单提交时出错:', error);
    }
}

// 运行主函数

async function app() {

    const need_validate = [
        {
            "spreadsheetToken": "TRVEb6Rk0aH8GusbqTvj2IQBpye",
            "sheetIds": [
                "tblBq8hK0Aq0lFaw",
            ],
            "token": "u-4JFaQZHPBaM8XYBFjA3iL2Jh28BT1kGVXE0wh4N00KIi"
        }
    ]

    for (const item of need_validate) {
        for (const sheetId of item.sheetIds) {
            const feishuConfig: FeishuConfig = {
                appId: process.env.FEISHU_APP_ID || 'cli_a8e91ed525f8502d',
                appSecret: process.env.FEISHU_APP_SECRET || 'iykFwwo19mBbfB6hlUUTChes80KBh6TK',
                spreadsheetToken: item.spreadsheetToken,
                sheetId: sheetId
            };

            validate(feishuConfig, item.token)
        }
    }
}

app()
import lark from '@larksuiteoapi/node-sdk';

// https://open.larksuite.com/open-apis/bot/v2/hook/2ed0c4cf-b2cb-4037-89ec-7d0b449a6c72
//curl -X POST -H "Content-Type: application/json" \
// -d '{"msg_type":"text","content":{"text":"request example"}}' \
// https://open.larksuite.com/open-apis/bot/v2/hook/****
async function sendMessage(user_id: string) {
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
                                    "title": "项目更新通知",
                                    "content": [
                                            [{
                                                            "tag": "text",
                                                            "text": "项目有更新: "
                                                    },
                                                    {
                                                            "tag": "a",
                                                            "text": "请查看\n",
                                                            "href": "http://www.example.com/"
                                                    },
                                                    {
                                                            "tag": "at",
                                                            "user_id": user_id
                                                    }
                                            ]
                                    ]
                            }
                    }
            }
        })}
    );
    console.log(response);
}

const client = new lark.Client({
    appId: 'cli_a8e91ed525f8502d',
    appSecret: 'iykFwwo19mBbfB6hlUUTChes80KBh6TK',
    // disableTokenCache为true时，SDK不会主动拉取并缓存token，这时需要在发起请求时，调用lark.withTenantToken("token")手动传递
    // disableTokenCache为false时，SDK会自动管理租户token的获取与刷新，无需使用lark.withTenantToken("token")手动传递token
    disableTokenCache: false
});

// 还可以使用迭代器的方式便捷的获取数据，无需手动维护page_token
(async () => {
for await (const item of await client.bitable.appTableRecord.listWithIterator({
        path: {
                app_token:'Oodab2EY6acs70sP7ljjjXoqpcc',
                table_id:'tblUr9qD36DXzjyo',
        },
        params: {
            view_id:'vewZVbQF2S',
            text_field_as_array:true,
            user_id_type:'open_id',
            display_formula_ref:true,
            automatic_fields:true,
            page_size:10,
        },
},
    lark.withTenantToken("pt-k68jX3aXXqNoGkCcsaoF3Db9YZRfypBiaCRfa2iXAQAAIsAAiCIAgdwQAoj_")
)) {
    for (const field of item?.items || []) {
        console.log(field);
        const name = field.fields.name;
        const nameText = typeof name === 'string' ? name : 
                        (typeof name === 'object' && name && 'text' in name) ? name.text || '' : 
                        String(name || '');
        sendMessage(field.last_modified_by?.id || '');

        
    }
}
})();
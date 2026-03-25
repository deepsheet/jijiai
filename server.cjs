// 阿里云 Token 代理服务器 - 使用正确的 RPC API 格式
const express = require('express');
const crypto = require('crypto');
const querystring = require('querystring');

const app = express();
const PORT = 3001;

// 阿里云配置
const ACCESS_KEY_ID = 'YOUR_ALIYUN_ACCESS_KEY_ID';
const ACCESS_KEY_SECRET = 'YOUR_ALIYUN_ACCESS_KEY_SECRET';

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

app.get('/token', async (req, res) => {
  try {
    console.log('开始获取 Token...');
    const token = await createToken();
    console.log('Token 获取成功:', token.substring(0, 20) + '...');
    res.json({ success: true, token, expireTime: Date.now() + 3600000 });
  } catch (error) {
    console.error('获取 Token 失败:', error.message);
    console.error('错误详情:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

async function createToken() {
  // 阿里云要求的时间格式：ISO8601，例如 2019-02-18T08:23:45Z
  const timestamp = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const nonce = crypto.randomUUID();
  
  // 构建请求参数（阿里云 RPC API 格式）
  const params = {
    Format: 'JSON',
    Version: '2019-02-28',
    AccessKeyId: ACCESS_KEY_ID,
    SignatureMethod: 'HMAC-SHA1',
    Timestamp: timestamp,
    SignatureVersion: '1.0',
    SignatureNonce: nonce,
    Action: 'CreateToken',
    RegionId: 'cn-shanghai'
  };
  
  // 构建签名字符串
  const sortedParams = Object.keys(params).sort().reduce((acc, key) => {
    acc[key] = params[key];
    return acc;
  }, {});
  
  const queryString = querystring.stringify(sortedParams);
  const stringToSign = `POST&%2F&${encodeURIComponent(queryString)}`;
  
  console.log('签名字符串:', stringToSign);
  
  // 计算签名
  const signature = crypto
    .createHmac('sha1', ACCESS_KEY_SECRET + '&')
    .update(stringToSign)
    .digest('base64');
  
  console.log('签名:', signature);
  
  params.Signature = signature;
  
  const url = 'http://nls-meta.cn-shanghai.aliyuncs.com/';
  
  console.log('请求参数:', JSON.stringify(params, null, 2));
  
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: querystring.stringify(params)
  });
  
  console.log('响应状态码:', response.status);
  const responseText = await response.text();
  console.log('响应内容:', responseText);
  
  // 尝试解析 JSON
  let data;
  try {
    data = JSON.parse(responseText);
  } catch (e) {
    throw new Error('阿里云 API 返回了非 JSON 响应：' + responseText.substring(0, 200));
  }
  
  if (data.Token && data.Token.Id) {
    console.log('Token 成功获取:', data.Token.Id);
    return data.Token.Id;
  } else if (data.Message) {
    throw new Error('阿里云 API 错误：' + data.Message);
  } else {
    throw new Error('获取 Token 失败：' + JSON.stringify(data));
  }
}

app.listen(PORT, () => {
  console.log(`\n✅ Token 代理服务器运行在 http://localhost:${PORT}`);
  console.log(`获取 Token: http://localhost:${PORT}/token\n`);
});

// 测试阿里云 Token 代理服务器
const http = require('http');

console.log('=== 测试阿里云 Token 代理服务器 ===\n');

// 测试代理服务器
http.get('http://localhost:3001/token', (res) => {
  let data = '';
  
  res.on('data', (chunk) => {
    data += chunk;
  });
  
  res.on('end', () => {
    console.log('响应状态码:', res.statusCode);
    console.log('响应内容:', data);
    console.log('\n响应头:', JSON.stringify(res.headers, null, 2));
    
    try {
      const json = JSON.parse(data);
      if (json.success && json.token) {
        console.log('\n✅ Token 获取成功!');
        console.log('Token:', json.token);
        console.log('过期时间:', new Date(json.expireTime).toLocaleString());
      } else {
        console.log('\n❌ Token 获取失败:', json.error);
      }
    } catch (e) {
      console.log('\n❌ 响应不是有效的 JSON');
      console.log('错误:', e.message);
      console.log('\n这可能是返回了 HTML 错误页面，说明代理服务器有问题');
    }
  });
}).on('error', (err) => {
  console.log('❌ 请求失败:', err.message);
  console.log('\n请确保代理服务器正在运行：node server.cjs');
});

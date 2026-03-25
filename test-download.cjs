// 测试 Whisper 模型下载
const { pipeline } = require('@xenova/transformers');

async function testDownload() {
  console.log('=== 开始测试模型下载 ===');
  console.log('测试时间:', new Date().toLocaleString('zh-CN'));
  
  const startTime = Date.now();
  
  try {
    console.log('\n1. 开始加载 Xenova/whisper-tiny 模型...');
    console.log('   模型大小：约 30-50MB');
    console.log('   请等待...\n');
    
    const transcriber = await pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny', {
      quantized: true,
      progress_callback: (progress) => {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(`[${elapsed}s] 进度：${progress.status} - ${progress.progress?.toFixed(1) || 0}%`);
      }
    });
    
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log('\n✅ 模型下载成功！');
    console.log(`   耗时：${elapsed}秒`);
    console.log(`   完成时间：${new Date().toLocaleString('zh-CN')}\n`);
    
    return true;
    
  } catch (error) {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.error('\n❌ 模型下载失败！');
    console.error(`   耗时：${elapsed}秒`);
    console.error(`   错误：${error.message}`);
    console.error(`   错误详情：${error.toString()}\n`);
    console.error('可能的原因：');
    console.error('   1. 网络连接问题（无法访问 Hugging Face 或其镜像）');
    console.error('   2. 防火墙或代理设置');
    console.error('   3. 内存不足\n');
    
    return false;
  }
}

testDownload().then(success => {
  process.exit(success ? 0 : 1);
});

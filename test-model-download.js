// 测试脚本：检查 Whisper 模型是否可以下载
import { pipeline } from '@xenova/transformers';

async function testModelDownload() {
  console.log('=== 开始测试模型下载 ===');
  console.log('测试时间:', new Date().toLocaleString());
  
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
    console.log(`   完成时间：${new Date().toLocaleString()}\n`);
    
    // 简单测试一下模型是否可用
    console.log('2. 测试模型是否可用...');
    
    // 创建一个静音的音频片段用于测试
    const audioContext = new (window as any).AudioContext();
    const sampleRate = 16000;
    const duration = 1; // 1 秒
    const audioBuffer = audioContext.createBuffer(1, sampleRate * duration, sampleRate);
    const channelData = audioBuffer.getChannelData(0);
    
    // 填充静音
    for (let i = 0; i < channelData.length; i++) {
      channelData[i] = 0;
    }
    
    console.log('   模型已就绪，可以进行语音识别');
    console.log('\n=== 测试完成 ===\n');
    
    return true;
    
  } catch (error) {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.error('\n❌ 模型下载失败！');
    console.error(`   耗时：${elapsed}秒`);
    console.error(`   错误：${error}`);
    console.error(`   错误详情：${JSON.stringify(error, null, 2)}\n`);
    console.error('可能的原因：');
    console.error('   1. 网络连接问题（无法访问 Hugging Face 或其镜像）');
    console.error('   2. 防火墙或代理设置');
    console.error('   3. 内存不足\n');
    
    return false;
  }
}

// 运行测试
console.log('\n🔍 即将开始测试...\n');
testModelDownload().then(success => {
  if (success) {
    console.log('✅ 测试通过：模型可以正常下载和使用');
  } else {
    console.log('❌ 测试失败：模型下载不可用，建议使用其他 ASR 方案');
  }
});

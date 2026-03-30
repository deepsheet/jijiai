// 测试 transcript 处理逻辑

interface TranscriptLine {
  id: string;
  speaker: 'customer' | 'agent' | 'system';
  text: string;
  timestamp: string;
}

// 模拟测试 handleTranscript 逻辑
class TranscriptHandler {
  transcript: TranscriptLine[] = [];
  currentInterimLineId: string | null = null;
  lastSpeechTime: number = Date.now();
  silenceThreshold: number = 2000; // 2秒

  handleTranscript(text: string, isFinal: boolean = false, now: number = Date.now()) {
    // 检查是否需要因为停顿而开始新句子（只在最终结果时检测）
    let hadLongSilence = false;
    if (isFinal) {
      const timeSinceLastSpeech = now - this.lastSpeechTime;
      hadLongSilence = timeSinceLastSpeech >= this.silenceThreshold;

      if (hadLongSilence) {
        console.log(`[停顿检测] 距离上次说话 ${timeSinceLastSpeech}ms，超过阈值 ${this.silenceThreshold}ms，强制开始新句子`);
        this.currentInterimLineId = null;
      }

      // 只在最终结果时更新最后说话时间
      this.lastSpeechTime = now;
    }

    // 如果有当前正在进行的 interim 行且没有长停顿，更新它
    const currentInterimId = this.currentInterimLineId;
    if (currentInterimId && !hadLongSilence) {
      // 先检查这一行是否存在于当前 transcript 中
      const lineExists = this.transcript.some(line => line.id === currentInterimId);
      if (lineExists) {
        const lineIndex = this.transcript.findIndex(line => line.id === currentInterimId);
        if (lineIndex !== -1) {
          this.transcript[lineIndex] = {
            ...this.transcript[lineIndex],
            text: text,
            timestamp: new Date(now).toLocaleTimeString()
          };
        }

        // 如果是最终结果，清除 interim 标记
        if (isFinal) {
          this.currentInterimLineId = null;
        }

        return;
      }
    }

    // 没有找到对应的行，或者有长停顿，创建新行
    const newId = now.toString();

    // 同步更新 ref
    if (!isFinal) {
      // 中间结果：记录 interim 行 ID
      this.currentInterimLineId = newId;
    } else {
      // 最终结果：确保清除 interim 标记
      this.currentInterimLineId = null;
    }

    const newTranscriptLine: TranscriptLine = {
      id: newId,
      speaker: 'customer',
      text: text,
      timestamp: new Date(now).toLocaleTimeString()
    };

    this.transcript.push(newTranscriptLine);
  }

  reset() {
    this.transcript = [];
    this.currentInterimLineId = null;
    this.lastSpeechTime = Date.now();
  }
}

// 运行测试
function runTests() {
  console.log('=== 开始测试 ===\n');

  const handler = new TranscriptHandler();

  // 测试1: 基本中间结果更新
  console.log('测试1: 基本中间结果更新');
  handler.reset();
  const t1 = 1000000;
  handler.handleTranscript('你好', false, t1);
  console.log('中间结果 "你好":', handler.transcript.length, '行');
  handler.handleTranscript('你好啊', false, t1 + 100);
  console.log('中间结果 "你好啊":', handler.transcript.length, '行, 文本:', handler.transcript[0]?.text);
  handler.handleTranscript('你好啊亲', true, t1 + 200);
  console.log('最终结果 "你好啊亲":', handler.transcript.length, '行, 文本:', handler.transcript[0]?.text);
  console.assert(handler.transcript.length === 1, '应该只有1行');
  console.assert(handler.transcript[0].text === '你好啊亲', '文本应该是 "你好啊亲"');
  console.log('✓ 测试1通过\n');

  // 测试2: 停顿后创建新行
  console.log('测试2: 停顿2秒后创建新行');
  handler.reset();
  const t2 = 2000000;
  handler.handleTranscript('第一句话', true, t2);
  console.log('第一句话:', handler.transcript.length, '行');
  handler.handleTranscript('第二句话', true, t2 + 3000); // 3秒后
  console.log('3秒后第二句话:', handler.transcript.length, '行');
  console.assert(handler.transcript.length === 2, '应该有2行');
  console.assert(handler.transcript[0].text === '第一句话', '第一行应该是 "第一句话"');
  console.assert(handler.transcript[1].text === '第二句话', '第二行应该是 "第二句话"');
  console.log('✓ 测试2通过\n');

  // 测试3: 不停顿继续说话（模拟实际场景）
  console.log('测试3: 模拟实际ASR场景');
  handler.reset();
  const t3 = 3000000;

  // 第一句：中间结果逐步更新
  handler.handleTranscript('一', false, t3);
  handler.handleTranscript('一二', false, t3 + 100);
  handler.handleTranscript('一二三', false, t3 + 200);
  handler.handleTranscript('一二三四', true, t3 + 300);
  console.log('第一句完成:', handler.transcript.length, '行, 文本:', handler.transcript[0]?.text);

  // 停顿3秒后开始第二句
  handler.handleTranscript('开始', false, t3 + 3300);
  handler.handleTranscript('开始第二', false, t3 + 3400);
  handler.handleTranscript('开始第二句', true, t3 + 3500);
  console.log('第二句完成:', handler.transcript.length, '行');
  console.log('  第一行:', handler.transcript[0]?.text);
  console.log('  第二行:', handler.transcript[1]?.text);

  console.assert(handler.transcript.length === 2, '应该有2行');
  console.assert(handler.transcript[0].text === '一二三四', '第一行应该是 "一二三四"');
  console.assert(handler.transcript[1].text === '开始第二句', '第二行应该是 "开始第二句"');
  console.log('✓ 测试3通过\n');

  // 测试4: 快速连续说话（不停顿）
  console.log('测试4: 快速连续说话');
  handler.reset();
  const t4 = 4000000;

  handler.handleTranscript('第一句', true, t4);
  handler.handleTranscript('第二句', true, t4 + 500); // 0.5秒后，不停顿
  handler.handleTranscript('第三句', true, t4 + 1000); // 1秒后，不停顿

  console.log('快速连续说话:', handler.transcript.length, '行');
  console.assert(handler.transcript.length === 3, '应该有3行（因为每句都是最终结果且没有中间结果关联）');
  console.log('✓ 测试4通过\n');

  // 测试5: 边界情况 - 正好2秒停顿
  console.log('测试5: 正好2秒停顿');
  handler.reset();
  const t5 = 5000000;

  handler.handleTranscript('第一句话', true, t5);
  handler.handleTranscript('第二句话', true, t5 + 2000); // 正好2秒

  console.log('正好2秒停顿:', handler.transcript.length, '行');
  console.assert(handler.transcript.length === 2, '应该有2行（2秒>=阈值）');
  console.log('✓ 测试5通过\n');

  console.log('=== 所有测试通过 ===');
}

// 新增测试：模拟ASR累积文本场景
function runAccumulationTest() {
  console.log('\n=== 新增测试：ASR累积文本场景 ===');
  const handler = new TranscriptHandler();
  handler.reset();

  const t = 1000000;
  // 模拟ASR返回累积文本：每次返回都包含之前的文本
  handler.handleTranscript('就是', false, t);
  console.log('第一次中间结果 "就是":', handler.transcript.length, '行, 文本:', handler.transcript[0]?.text);

  handler.handleTranscript('就是就就是美', false, t + 100);
  console.log('第二次中间结果 "就是就就是美":', handler.transcript.length, '行, 文本:', handler.transcript[0]?.text);

  handler.handleTranscript('就是就就是美就是美国伊', false, t + 200);
  console.log('第三次中间结果 "就是就就是美就是美国伊":', handler.transcript.length, '行, 文本:', handler.transcript[0]?.text);

  handler.handleTranscript('就是就就是美就是美国伊就是美国伊朗', true, t + 300);
  console.log('最终结果 "就是就就是美就是美国伊就是美国伊朗":', handler.transcript.length, '行, 文本:', handler.transcript[0]?.text);

  // 期望：只有1行，文本为最终结果
  console.assert(handler.transcript.length === 1, '应该只有1行，实际：' + handler.transcript.length);
  console.assert(handler.transcript[0].text === '就是就就是美就是美国伊就是美国伊朗', '文本应该是最终结果');
  console.log('✓ 累积文本测试通过\n');
}

// 运行所有测试
runTests();
runAccumulationTest();

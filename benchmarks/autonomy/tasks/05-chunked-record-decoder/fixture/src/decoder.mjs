export function createRecordDecoder() {
  let pending = '';
  let line = 1;
  let flushed = false;

  function parse(text) {
    if (text.trim() === '') return [];
    try {
      return [JSON.parse(text)];
    } catch (error) {
      throw new Error(`Invalid JSON on line ${line}: ${error.message}`);
    }
  }

  return {
    push(chunk) {
      if (flushed) throw new Error('decoder already flushed');
      pending += Buffer.from(chunk).toString('utf8');
      const parts = pending.split('\n');
      pending = parts.pop() ?? '';
      const values = [];
      for (const part of parts) {
        values.push(...parse(part));
        line += 1;
      }
      return values;
    },
    flush() {
      if (flushed) return [];
      flushed = true;
      return parse(pending);
    },
  };
}

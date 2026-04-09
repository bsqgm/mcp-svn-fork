import { describe, expect, it } from '@jest/globals';
import iconv from 'iconv-lite';
import { decodeSvnOutput, parseLogOutput } from '../common/utils.js';

describe('SVN log parsing', () => {
  it('should parse XML log output and keep the latest entry', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<log>
<logentry revision="105">
<author>alice</author>
<date>2026-04-09T06:00:00.000000Z</date>
<msg>latest change</msg>
</logentry>
<logentry revision="104">
<author>bob</author>
<date>2026-04-08T06:00:00.000000Z</date>
<msg>older change</msg>
</logentry>
</log>`;

    const entries = parseLogOutput(xml);

    expect(entries).toHaveLength(2);
    expect(entries[0].revision).toBe(105);
    expect(entries[0].message).toBe('latest change');
    expect(entries[1].revision).toBe(104);
  });

  it('should sort entries by latest revision first even if SVN output is oldest first', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<log>
<logentry revision="104">
<author>bob</author>
<date>2026-04-08T06:00:00.000000Z</date>
<msg>older change</msg>
</logentry>
<logentry revision="105">
<author>alice</author>
<date>2026-04-09T06:00:00.000000Z</date>
<msg>latest change</msg>
</logentry>
</log>`;

    const entries = parseLogOutput(xml);

    expect(entries).toHaveLength(2);
    expect(entries[0].revision).toBe(105);
    expect(entries[1].revision).toBe(104);
  });

  it('should decode XML entities in log messages', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<log>
<logentry revision="8">
<author>alice</author>
<date>2026-04-09T06:00:00.000000Z</date>
<msg>fix &amp; verify &lt;main&gt;</msg>
</logentry>
</log>`;

    const entries = parseLogOutput(xml);

    expect(entries[0].message).toBe('fix & verify <main>');
  });
});

describe('SVN output decoding', () => {
  it('should decode UTF-8 output', () => {
    const text = '修复中文日志';
    const decoded = decodeSvnOutput(Buffer.from(text, 'utf8'));

    expect(decoded).toBe(text);
  });

  it('should decode GBK output used by Windows SVN consoles', () => {
    const text = '修复中文日志';
    const buffer = iconv.encode(text, 'gb18030');
    const decoded = decodeSvnOutput(buffer);

    expect(decoded).toBe(text);
  });
});

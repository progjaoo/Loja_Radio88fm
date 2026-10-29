import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { inspectStoreVideo, isOwnedHomepagePosterUrl, isOwnedHomepageVideoUrl } from './store-video.ts';

function box(type: string, payload: Buffer): Buffer {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(payload.length + header.length, 0);
  header.write(type, 4, 4, 'ascii');
  return Buffer.concat([header, payload]);
}

function movie({ duration = 10, width = 1280, height = 640, codec = 'avc1', handler = 'vide' } = {}): Buffer {
  const mvhd = Buffer.alloc(20);
  mvhd.writeUInt32BE(1000, 12);
  mvhd.writeUInt32BE(duration * 1000, 16);
  const tkhd = Buffer.alloc(84);
  tkhd.writeUInt32BE(width * 65_536, 76);
  tkhd.writeUInt32BE(height * 65_536, 80);
  const hdlr = Buffer.alloc(20);
  hdlr.write(handler, 8, 4, 'ascii');
  const stsd = Buffer.concat([Buffer.alloc(8), Buffer.from(codec, 'ascii')]);
  const stbl = box('stbl', box('stsd', stsd));
  const minf = box('minf', stbl);
  const mdia = box('mdia', Buffer.concat([box('hdlr', hdlr), minf]));
  const trak = box('trak', Buffer.concat([box('tkhd', tkhd), mdia]));
  const ftyp = box('ftyp', Buffer.from('isom0000isom', 'ascii'));
  return Buffer.concat([ftyp, box('moov', Buffer.concat([box('mvhd', mvhd), trak]))]);
}

test('accepts a silent H.264 MP4 with supported dimensions and duration', () => {
  assert.deepEqual(inspectStoreVideo(movie()), { ok: true, metadata: { width: 1280, height: 640, durationSeconds: 10 } });
});

test('rejects non-MP4 data and missing H.264 sample entries', () => {
  assert.equal(inspectStoreVideo(Buffer.from('not a video')).ok, false);
  const codec = inspectStoreVideo(movie({ codec: 'mp4v' }));
  assert.equal(codec.ok, false);
  if (!codec.ok) assert.match(codec.message, /H\.264/);
});

test('rejects audio tracks and videos longer than fifteen seconds', () => {
  const audio = inspectStoreVideo(movie({ handler: 'soun' }));
  assert.equal(audio.ok, false);
  if (!audio.ok) assert.match(audio.message, /áudio/);
  const duration = inspectStoreVideo(movie({ duration: 16 }));
  assert.equal(duration.ok, false);
  if (!duration.ok) assert.match(duration.message, /15 segundos/);
});

test('rejects dimensions outside the supported range', () => {
  const result = inspectStoreVideo(movie({ width: 256 }));
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.message, /320 × 320/);
});

test('accepts only UUID-backed R2 media and the bundled demo media paths', () => {
  const fileId = 'c8111b20-11e7-4f30-883a-c098d665ac11';
  const r2 = 'https://pub-example.r2.dev';
  const app = 'http://localhost:20439';
  assert.equal(isOwnedHomepageVideoUrl(`${r2}/storefront/${fileId}.mp4`, r2, app), true);
  assert.equal(isOwnedHomepagePosterUrl(`${r2}/storefront/${fileId}.png`, r2, app), true);
  assert.equal(isOwnedHomepageVideoUrl('https://untrusted.example/clip.mp4', r2, app), false);
  assert.equal(isOwnedHomepageVideoUrl(`${app}/demo/homepage/estrelas-mobile.mp4`, r2, app), true);
  assert.equal(isOwnedHomepageVideoUrl(`${app}/demo/homepage/other.mp4`, r2, app), false);
  assert.equal(isOwnedHomepagePosterUrl(`${app}/demo/homepage/estrelas-poster-mobile.png`, r2, app), true);
});

test('bundled desktop and mobile demo MP4s pass the same server-side media checks', () => {
  for (const file of ['estrelas-desktop.mp4', 'estrelas-mobile.mp4']) {
    const bytes = readFileSync(new URL(`../../../radio88-store/public/demo/homepage/${file}`, import.meta.url));
    const result = inspectStoreVideo(bytes);
    assert.equal(result.ok, true, result.ok ? undefined : result.message);
    if (result.ok) assert.ok(result.metadata.durationSeconds <= 15);
  }
});

import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  decodeFrames,
  DiscordIpcClient,
  encodeFrame,
  OPCODE_FRAME,
  OPCODE_HANDSHAKE,
} from '../src/discord/ipc.js';

test('encodeFrame and decodeFrames handle fragmented and coalesced frames', () => {
  const f1 = encodeFrame(OPCODE_HANDSHAKE, { v: 1, client_id: '12345' });
  const f2 = encodeFrame(OPCODE_FRAME, { cmd: 'SET_ACTIVITY', nonce: 'n1' });
  const combined = Buffer.concat([f1, f2]);

  // Split right in the middle of frame 2
  const partA = combined.subarray(0, f1.length + 12);
  const partB = combined.subarray(f1.length + 12);

  const firstPass = decodeFrames(partA);
  assert.equal(firstPass.frames.length, 1);
  assert.equal(firstPass.frames[0]?.opcode, OPCODE_HANDSHAKE);
  assert.equal(firstPass.frames[0]?.payload.client_id, '12345');
  assert.ok(firstPass.remainder.length > 0);

  const secondPass = decodeFrames(Buffer.concat([firstPass.remainder, partB]));
  assert.equal(secondPass.frames.length, 1);
  assert.equal(secondPass.frames[0]?.opcode, OPCODE_FRAME);
  assert.equal(secondPass.frames[0]?.payload.nonce, 'n1');
  assert.equal(secondPass.remainder.length, 0);
});

test('DiscordIpcClient completes handshake, SET_ACTIVITY, and CLEAR_ACTIVITY against mock IPC socket', async () => {
  const sockPath = path.join(os.tmpdir(), `agent-rpc-test-${process.pid}-${Date.now()}.sock`);
  const receivedCommands: Array<Record<string, unknown>> = [];

  const server = net.createServer((conn) => {
    let buf: Buffer = Buffer.alloc(0);
    conn.on('data', (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk]);
      const { frames, remainder } = decodeFrames(buf);
      buf = remainder;
      for (const frame of frames) {
        if (frame.opcode === OPCODE_HANDSHAKE) {
          conn.write(
            encodeFrame(OPCODE_FRAME, {
              cmd: 'DISPATCH',
              evt: 'READY',
              data: { user: { id: '42', username: 'testdev' } },
            }),
          );
        } else if (frame.opcode === OPCODE_FRAME) {
          receivedCommands.push(frame.payload);
          conn.write(
            encodeFrame(OPCODE_FRAME, {
              cmd: frame.payload.cmd,
              evt: null,
              nonce: frame.payload.nonce,
              data: { ok: true },
            }),
          );
        }
      }
    });
  });

  await new Promise<void>((resolve) => server.listen(sockPath, () => resolve()));

  try {
    const client = new DiscordIpcClient('9876543210');
    const user = await client.connect([sockPath], 3000);
    assert.equal(user?.username, 'testdev');
    assert.equal(client.isConnected, true);

    await client.setActivity({
      details: 'Usage · 38% weekly',
      state: 'session 45% · resets Wed',
      party: { id: 'agent-rpc-sessions', size: [3, 3] },
    });
    await client.clearActivity();
    await client.close();

    assert.equal(receivedCommands.length, 2);
    const setArgs = receivedCommands[0]?.args as { activity?: { details?: string } };
    const clearArgs = receivedCommands[1]?.args as { activity?: unknown };
    assert.equal(setArgs.activity?.details, 'Usage · 38% weekly');
    assert.equal(clearArgs.activity, null);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    try {
      fs.unlinkSync(sockPath);
    } catch {
      // Ignore
    }
  }
});

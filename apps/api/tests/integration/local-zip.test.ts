import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import Fastify from 'fastify';
import type { CreateRepositoryWithCommitAndFilesInput } from '@bugzero/database';
import { registerLocalZipRepositoryRoute } from '../../src/modules/repositories/local-zip.js';

const organizationId = '11111111-1111-4111-8111-111111111111';
const repositoryId = '22222222-2222-4222-8222-222222222222';
const userId = '33333333-3333-4333-8333-333333333333';
const source = `function handler(req) {
  const sourceId = req.query.id;
  const id = sourceId;
  const sql = "SELECT * FROM users WHERE id=" + id;
  db.query(sql);
}`;

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function makeZip(entries: Array<{ path: string; content: string; unixMode?: number }>): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let localOffset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.path, 'utf8');
    const content = Buffer.from(entry.content, 'utf8');
    const checksum = crc32(content);
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(content.length, 18);
    localHeader.writeUInt32LE(content.length, 22);
    localHeader.writeUInt16LE(name.length, 26);
    localParts.push(localHeader, name, content);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(content.length, 20);
    centralHeader.writeUInt32LE(content.length, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt32LE(((entry.unixMode ?? 0x81a4) << 16) >>> 0, 38);
    centralHeader.writeUInt32LE(localOffset, 42);
    centralParts.push(centralHeader, name);
    localOffset += localHeader.length + name.length + content.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(localOffset, 16);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

test('authenticated local ZIP upload persists source content with a Git snapshot revision', async () => {
  const captured: CreateRepositoryWithCommitAndFilesInput[] = [];
  const sourceWithBom = `\uFEFF${source}`;
  const app = Fastify();
  app.addContentTypeParser('application/zip', { parseAs: 'buffer' }, (_request, body, done) => done(null, body));
  registerLocalZipRepositoryRoute(app, {
    async authenticate() {
      return { organizationId, userId };
    },
    members: {
      async getMembership() {
        return {
          id: 'member',
          organization_id: organizationId,
          user_id: userId,
          role: 'DEVELOPER',
          created_at: new Date(0).toISOString(),
          updated_at: new Date(0).toISOString(),
        };
      },
    },
    repositories: {
      async createWithCommitAndFiles(input) {
        captured.push(input);
        const timestamp = new Date(0).toISOString();
        return {
          repository: {
            id: repositoryId,
            organization_id: organizationId,
            provider: 'LOCAL',
            external_id: 'local-fixture',
            full_name: input.fullName,
            default_branch: 'main',
            clone_url: 'local://local-fixture',
            created_at: timestamp,
            updated_at: timestamp,
          },
          commit: {
            id: '44444444-4444-4444-8444-444444444444',
            organization_id: organizationId,
            repository_id: repositoryId,
            commit_sha: input.commitSha,
            parent_commit_sha: null,
            committed_at: timestamp,
            indexed_at: timestamp,
            created_at: timestamp,
          },
        };
      },
    },
  });

  try {
    const response = await app.inject({
      method: 'POST',
      url: '/repositories/local-zip',
      headers: {
        'content-type': 'application/zip',
        'x-repository-name': 'Local Fixture',
      },
      payload: makeZip([{ path: 'src\\vulnerable.ts', content: sourceWithBom }]),
    });
    assert.equal(response.statusCode, 201);
    const result = response.json();
    assert.equal(result.repository.provider, 'LOCAL');
    assert.match(result.revision.commitSha, /^[a-f0-9]{40}$/);
    assert.equal(result.filesPersisted, 1);
    assert.equal(result.totalBytes, Buffer.byteLength(sourceWithBom));
    assert.equal(captured[0]?.files[0]?.sourceContent, sourceWithBom);
    assert.equal(captured[0]?.files[0]?.contentSha256, createHash('sha256').update(sourceWithBom).digest('hex'));
    assert.equal(captured[0]?.files[0]?.path, 'src/vulnerable.ts');
    assert.equal(captured[0]?.files[0]?.language, 'TypeScript');
  } finally {
    await app.close();
  }
});

test('local ZIP upload rejects symlink entries before persistence', async () => {
  let persisted = false;
  const app = Fastify();
  app.addContentTypeParser('application/zip', { parseAs: 'buffer' }, (_request, body, done) => done(null, body));
  registerLocalZipRepositoryRoute(app, {
    async authenticate() {
      return { organizationId, userId };
    },
    members: {
      async getMembership() {
        return {
          id: 'member',
          organization_id: organizationId,
          user_id: userId,
          role: 'DEVELOPER',
          created_at: '',
          updated_at: '',
        };
      },
    },
    repositories: {
      async createWithCommitAndFiles() {
        persisted = true;
        throw new Error('Symlink ZIP must not be persisted');
      },
    },
  });

  try {
    const response = await app.inject({
      method: 'POST',
      url: '/repositories/local-zip',
      headers: {
        'content-type': 'application/zip',
        'x-repository-name': 'Symlink Fixture',
      },
      payload: makeZip([{ path: 'src/link.ts', content: 'target.ts', unixMode: 0xa1ff }]),
    });
    assert.equal(response.statusCode, 400);
    assert.match(response.json().error, /entry types/i);
    assert.equal(persisted, false);
  } finally {
    await app.close();
  }
});

test('local ZIP upload rejects path traversal before persisting any files', async () => {
  let persisted = false;
  const app = Fastify();
  app.addContentTypeParser('application/zip', { parseAs: 'buffer' }, (_request, body, done) => done(null, body));
  registerLocalZipRepositoryRoute(app, {
    async authenticate() {
      return { organizationId, userId };
    },
    members: {
      async getMembership() {
        return {
          id: 'member',
          organization_id: organizationId,
          user_id: userId,
          role: 'DEVELOPER',
          created_at: '',
          updated_at: '',
        };
      },
    },
    repositories: {
      async createWithCommitAndFiles() {
        persisted = true;
        throw new Error('Unsafe ZIP must not be persisted');
      },
    },
  });

  try {
    const response = await app.inject({
      method: 'POST',
      url: '/repositories/local-zip',
      headers: {
        'content-type': 'application/zip',
        'x-repository-name': 'Unsafe Fixture',
      },
      payload: makeZip([{ path: '../escape.ts', content: source }]),
    });
    assert.equal(response.statusCode, 400);
    assert.match(response.json().error, /ZIP/);
    assert.equal(persisted, false);
  } finally {
    await app.close();
  }
});

  test('local ZIP upload rejects a source entry with a corrupted CRC before persistence', async () => {
    let persisted = false;
    const app = Fastify();
    app.addContentTypeParser('application/zip', { parseAs: 'buffer' }, (_request, body, done) => done(null, body));
    registerLocalZipRepositoryRoute(app, {
      async authenticate() {
        return { organizationId, userId };
      },
      members: {
        async getMembership() {
          return {
            id: 'member',
            organization_id: organizationId,
            user_id: userId,
            role: 'DEVELOPER',
            created_at: '',
            updated_at: '',
          };
        },
      },
      repositories: {
        async createWithCommitAndFiles() {
          persisted = true;
          throw new Error('Corrupted ZIP must not be persisted');
        },
      },
    });

    try {
      const archive = makeZip([{ path: 'src/vulnerable.ts', content: source }]);
      archive[30 + Buffer.byteLength('src/vulnerable.ts')] ^= 0xff;
      const response = await app.inject({
        method: 'POST',
        url: '/repositories/local-zip',
        headers: {
          'content-type': 'application/zip',
          'x-repository-name': 'Corrupt Fixture',
        },
        payload: archive,
      });
      assert.equal(response.statusCode, 400);
      assert.match(response.json().error, /corrupted|invalid/i);
      assert.equal(persisted, false);
    } finally {
      await app.close();
    }
  });

  test('identical ZIP snapshots generate the same commit identity', async () => {
    const commitShas: string[] = [];
    const app = Fastify();
    app.addContentTypeParser('application/zip', { parseAs: 'buffer' }, (_request, body, done) => done(null, body));
    registerLocalZipRepositoryRoute(app, {
      async authenticate() {
        return { organizationId, userId };
      },
      members: {
        async getMembership() {
          return {
            id: 'member',
            organization_id: organizationId,
            user_id: userId,
            role: 'DEVELOPER',
            created_at: '',
            updated_at: '',
          };
        },
      },
      repositories: {
        async createWithCommitAndFiles(input) {
          commitShas.push(input.commitSha);
          const timestamp = new Date(0).toISOString();
          return {
            repository: {
              id: repositoryId,
              organization_id: organizationId,
              provider: 'LOCAL',
              external_id: 'deterministic-fixture',
              full_name: input.fullName,
              default_branch: 'main',
              clone_url: 'local://deterministic-fixture',
              created_at: timestamp,
              updated_at: timestamp,
            },
            commit: {
              id: '44444444-4444-4444-8444-444444444444',
              organization_id: organizationId,
              repository_id: repositoryId,
              commit_sha: input.commitSha,
              parent_commit_sha: null,
              committed_at: timestamp,
              indexed_at: timestamp,
              created_at: timestamp,
            },
          };
        },
      },
    });

    try {
      const archive = makeZip([{ path: 'src/vulnerable.ts', content: source }]);
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const response = await app.inject({
          method: 'POST',
          url: '/repositories/local-zip',
          headers: {
            'content-type': 'application/zip',
            'x-repository-name': 'Deterministic Fixture',
          },
          payload: archive,
        });
        assert.equal(response.statusCode, 201);
      }
      assert.equal(commitShas.length, 2);
      assert.equal(commitShas[0], commitShas[1]);
    } finally {
      await app.close();
    }
  });

// Files on the local disk, behind the one interface the file store and the upload transport
// use. Keys are store paths - forward slashes, relative to the root this instance was made
// with - and a folder is a real folder here; a cloud backend (S3, Azure Blob, GCS) would
// implement the same methods with a folder as a key prefix, and nothing above this file would
// change. Every method is async, and the callers validate keys before they get here.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

export class LocalStorage {
  constructor(root) {
    this.root = path.resolve(root);
  }

  // The absolute path of a key; the callers' validation keeps keys inside the root.
  resolve(key) {
    return key ? path.join(this.root, ...String(key).split('/')) : this.root;
  }

  // Writes a Buffer, a string or a readable stream, making the folders on the way and
  // replacing whatever was there.
  async put(key, source) {
    const file = this.resolve(key);
    await fsp.mkdir(path.dirname(file), { recursive: true });
    if (source instanceof Readable || (source && typeof source.pipe === 'function')) {
      await pipeline(source, fs.createWriteStream(file));
    } else {
      await fsp.writeFile(file, source);
    }
  }

  async get(key) {
    return fsp.readFile(this.resolve(key));
  }

  // The readable stream of a file. The file's existence is checked first, so a missing key
  // rejects here rather than erroring on the stream later.
  async stream(key) {
    const file = this.resolve(key);
    await fsp.access(file);
    return fs.createReadStream(file);
  }

  // { size, modified, folder } or null when there is nothing at the key.
  async stat(key) {
    try {
      const info = await fsp.stat(this.resolve(key));
      return { size: info.isDirectory() ? 0 : info.size, modified: info.mtime.toISOString(), folder: info.isDirectory() };
    } catch (err) {
      if (err.code === 'ENOENT' || err.code === 'ENOTDIR') return null;
      throw err;
    }
  }

  async exists(key) {
    return (await this.stat(key)) !== null;
  }

  // One level of a folder: [{ name, folder, size, modified }], or null when the folder is
  // not there.
  async list(prefix) {
    const dir = this.resolve(prefix);
    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch (err) {
      if (err.code === 'ENOENT' || err.code === 'ENOTDIR') return null;
      throw err;
    }
    const out = [];
    for (const entry of entries) {
      if (!entry.isFile() && !entry.isDirectory()) continue;
      const info = await fsp.stat(path.join(dir, entry.name));
      out.push({ name: entry.name, folder: entry.isDirectory(), size: entry.isDirectory() ? 0 : info.size, modified: info.mtime.toISOString() });
    }
    return out;
  }

  async mkdir(key) {
    await fsp.mkdir(this.resolve(key), { recursive: true });
  }

  // A file or a folder, to a key that must be free; the target's folders are made.
  async move(from, to) {
    const target = this.resolve(to);
    await fsp.mkdir(path.dirname(target), { recursive: true });
    await fsp.rename(this.resolve(from), target);
  }

  // Takes a file from outside the store (a finished upload part) and puts it at the key: a
  // rename when the two are on one volume, a copy and delete otherwise.
  async adopt(key, sourcePath) {
    const target = this.resolve(key);
    await fsp.mkdir(path.dirname(target), { recursive: true });
    try {
      await fsp.rename(sourcePath, target);
    } catch (err) {
      if (err.code !== 'EXDEV') throw err;
      await fsp.copyFile(sourcePath, target);
      await fsp.unlink(sourcePath);
    }
  }

  // A file, or an empty folder. A folder with something in it rejects with ENOTEMPTY.
  async remove(key) {
    const file = this.resolve(key);
    const info = await fsp.stat(file);
    if (info.isDirectory()) await fsp.rmdir(file);
    else await fsp.unlink(file);
  }

  // Everything under the key, the folder itself included; nothing there is not an error.
  async removeTree(prefix) {
    await fsp.rm(this.resolve(prefix), { recursive: true, force: true });
  }
}

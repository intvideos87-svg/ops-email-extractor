declare module "msgreader" {
  export default class MsgReader {
    constructor(arrayBuffer: ArrayBuffer);
    getFileData(): unknown;
  }
}

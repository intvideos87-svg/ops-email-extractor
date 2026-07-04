declare module "msgreader" {
  export default class MsgReader {
    constructor(arrayBuffer: ArrayBuffer);
    getFileData(): unknown;
  }
}

declare module "msgreader/lib/const" {
  const MsgReaderConst: {
    MSG: {
      FIELD: {
        NAME_MAPPING: Record<string, string>;
      };
    };
  };

  export default MsgReaderConst;
}

/**
 * Build-time constants injected by esbuild's `define`.
 * This is how one codebase becomes three products.
 */
interface ImportMetaEnv {
  /** 'ascend' */
  readonly PRODUCT: string;
  /** e.g. 'Offset Align'. Latin, always: this is what the PDFs print. */
  readonly PRODUCT_NAME: string;
  /** Empty unless there is ever more than one edition to tell apart. */
  readonly EDITION: string;
  /** e.g. 'NIST Cybersecurity Framework 2.0' */
  readonly FRAMEWORK: string;
  readonly DEV: boolean;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

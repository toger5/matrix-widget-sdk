// The wasm module is loaded by URL (see index.ts); bundlers such as Vite resolve `?url` imports.
declare module "*.wasm?url" {
  const url: string;
  export default url;
}

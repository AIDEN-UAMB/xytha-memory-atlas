declare module 'cloudflare:workers' {
  interface Statement {
    bind(...values: unknown[]): Statement;
    first<T=Record<string, unknown>>(column?: string): Promise<T|null>;
    all<T=Record<string, unknown>>(): Promise<{results:T[];success:boolean;meta:{changes:number}}>;
    run(): Promise<{success:boolean;meta:{changes:number}}>;
  }
  export const env: {DB:{prepare(query:string):Statement;batch(statements:Statement[]):Promise<{success:boolean;meta:{changes:number}}[]>};[key:string]:unknown};
}

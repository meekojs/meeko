export interface HeadMeta { name?: string; property?: string; httpEquiv?: string; content: string; key?: string }
export interface HeadLink { rel: string; href: string; hreflang?: string; type?: string; media?: string; sizes?: string; as?: string; crossorigin?: "" | "anonymous" | "use-credentials"; key?: string }
export interface HeadScript { src?: string; type?: string; async?: boolean; defer?: boolean; module?: boolean; children?: string; key?: string }
export interface HeadStyle { children: string; media?: string; key?: string }
export interface HeadInput { title?: string; titleTemplate?: string | ((title: string) => string); meta?: HeadMeta[]; link?: HeadLink[]; script?: HeadScript[]; style?: HeadStyle[]; htmlAttrs?: Record<string, string | undefined>; bodyAttrs?: Record<string, string | undefined> }
export interface DocumentConfig { lang?: string; head?: HeadInput }

export type If<C, A, B = null> = C extends true ? A : C extends false ? B : never

export type station<Raw extends boolean = true> = {
    authors: If<Raw, string, string[]>;
    beats: string;
    id: string;
    img: string;
    title: string;
    tracks: If<Raw, string, Record<string, string>>;
    url: string;
}
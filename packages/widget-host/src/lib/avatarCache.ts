/**
 * Avatars as object URLs an `<img>` can show. Media needs the access token, so a plain URL would
 * not do. Each `mxc://` URI is downloaded once per session.
 */
export class AvatarCache {
  private readonly urls = new Map<string, Promise<string | undefined>>();

  /** `download` fetches a small thumbnail of the media at an `mxc://` URI. */
  constructor(private readonly download: (mxcUrl: string) => Promise<Blob | ArrayBuffer>) {}

  /** Resolves to `undefined` when the avatar cannot be downloaded; the caller shows its placeholder then. */
  get(mxcUrl: string): Promise<string | undefined> {
    let url = this.urls.get(mxcUrl);
    if (!url) {
      url = this.download(mxcUrl).then(
        (data) => URL.createObjectURL(data instanceof Blob ? data : new Blob([data])),
        (e: unknown) => {
          console.warn(`downloading the avatar ${mxcUrl} failed`, e);
          return undefined;
        },
      );
      this.urls.set(mxcUrl, url);
    }
    return url;
  }

  /** Release the object URLs, when the session ends. */
  clear(): void {
    for (const url of this.urls.values()) void url.then((u) => u && URL.revokeObjectURL(u));
    this.urls.clear();
  }
}

/** The size avatars are asked for, in pixels: twice what the room list shows, for high-density screens. */
export const AVATAR_SIZE = 64;

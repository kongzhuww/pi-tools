import { ProxyAgent, type Dispatcher } from "undici";

let sharedDispatcher: Dispatcher | undefined;

export function getSharedDispatcher(): Dispatcher | undefined {
  if (!sharedDispatcher) {
    const proxy =
      process.env.HTTPS_PROXY ??
      process.env.https_proxy ??
      process.env.HTTP_PROXY ??
      process.env.http_proxy;
    if (proxy) {
      sharedDispatcher = new ProxyAgent(proxy);
    }
  }
  return sharedDispatcher;
}

export async function closeSharedDispatcher(): Promise<void> {
  if (sharedDispatcher && "close" in sharedDispatcher) {
    await sharedDispatcher.close();
    sharedDispatcher = undefined;
  }
}

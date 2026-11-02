export const IP_GRABBER_PROVIDER_IDS = ["grabify", "iplogger"] as const;

export type IpGrabberProviderId = (typeof IP_GRABBER_PROVIDER_IDS)[number];

export interface IpGrabberProviderInfo {
  id: IpGrabberProviderId;
  name: string;
  description: string;
  /** Known domains, always blocked while the provider is on. Detection adds more. */
  seedDomains: readonly string[];
}

export const IP_GRABBER_PROVIDERS: Record<
  IpGrabberProviderId,
  IpGrabberProviderInfo
> = {
  grabify: {
    id: "grabify",
    name: "Grabify",
    description: "grabify.link and its other tracking domains",
    seedDomains: [
      "grabify.link",
      "foot.wiki",
      "gamingfun.me",
      "imagehub.fun",
      "mymap.icu",
      "myprivate.pics",
      "photospace.life",
      "screenshare.pics",
      "screenshot.best",
      "screensnaps.top",
      "stopify.co",
      "xtube.chat",
    ],
  },
  iplogger: {
    id: "iplogger",
    name: "IPLogger",
    description: "iplogger.org, 2no.co, yip.su and similar",
    seedDomains: [
      "iplogger.org",
      "iplogger.com",
      "iplogger.info",
      "iplogger.ru",
      "2no.co",
      "bc.ax",
      "ed.tc",
      "ipgraber.ru",
      "ipgrabber.ru",
      "iplis.ru",
      "maper.info",
      "wl.gl",
      "yip.su",
    ],
  },
};

export function isIpGrabberProviderId(
  value: string,
): value is IpGrabberProviderId {
  return (IP_GRABBER_PROVIDER_IDS as readonly string[]).includes(value);
}

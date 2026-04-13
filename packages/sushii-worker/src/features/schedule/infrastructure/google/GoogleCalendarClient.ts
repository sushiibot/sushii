const CALENDAR_API_BASE = "https://www.googleapis.com/calendar/v3";

export interface CalendarMetadata {
  summary: string;
  timeZone: string;
}

export interface CalendarEventItem {
  id: string;
  summary?: string;
  status: "confirmed" | "tentative" | "cancelled";
  start?: {
    dateTime?: string;
    date?: string;
    timeZone?: string;
  };
  end?: {
    dateTime?: string;
    date?: string;
  };
  location?: string;
  htmlLink?: string;
}

export interface ListEventsResponse {
  items: CalendarEventItem[];
  nextSyncToken?: string;
  nextPageToken?: string;
}

export type ListEventsOptions = (
  | { syncToken: string; timeMin?: never; timeMax?: never }
  | { syncToken?: never; timeMin?: string; timeMax?: string }
) & { pageToken?: string };

export class GoogleCalendarError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    cause?: unknown,
  ) {
    super(message, { cause });
    this.name = "GoogleCalendarError";
  }
}

export class GoogleCalendarClient {
  constructor(private readonly apiKey: string) {}

  async getCalendarMetadata(calendarId: string): Promise<CalendarMetadata> {
    const url = new URL(`${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}`);
    url.searchParams.set("key", this.apiKey);
    url.searchParams.set("fields", "summary,timeZone");

    const response = await fetch(url.toString());

    if (!response.ok) {
      throw new GoogleCalendarError(
        `Failed to get calendar metadata: ${response.statusText}`,
        response.status,
      );
    }

    const data = (await response.json()) as { summary: string; timeZone: string };
    return {
      summary: data.summary ?? "",
      timeZone: data.timeZone ?? "UTC",
    };
  }

  async listEvents(
    calendarId: string,
    options: ListEventsOptions = {},
  ): Promise<ListEventsResponse> {
    const allItems: CalendarEventItem[] = [];
    let nextSyncToken: string | undefined;
    let pageToken: string | undefined = options.pageToken;

    do {
      const url = new URL(
        `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events`,
      );
      url.searchParams.set("key", this.apiKey);

      if (options.syncToken) {
        url.searchParams.set("syncToken", options.syncToken);
      } else {
        url.searchParams.set("singleEvents", "true");
        if (options.timeMin) url.searchParams.set("timeMin", options.timeMin);
        if (options.timeMax) url.searchParams.set("timeMax", options.timeMax);
      }

      if (pageToken) {
        url.searchParams.set("pageToken", pageToken);
      }

      const response = await fetch(url.toString());

      if (!response.ok) {
        throw new GoogleCalendarError(
          `Failed to list events: ${response.statusText}`,
          response.status,
        );
      }

      const data = (await response.json()) as {
        items?: CalendarEventItem[];
        nextSyncToken?: string;
        nextPageToken?: string;
      };

      allItems.push(...(data.items ?? []));
      nextSyncToken = data.nextSyncToken;
      pageToken = data.nextPageToken;
    } while (pageToken);

    return { items: allItems, nextSyncToken };
  }
}

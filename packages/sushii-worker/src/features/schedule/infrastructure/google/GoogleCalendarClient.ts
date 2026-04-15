import opentelemetry, { SpanKind, SpanStatusCode } from "@opentelemetry/api";
import type { Logger } from "pino";

const CALENDAR_API_BASE = "https://www.googleapis.com/calendar/v3";
const GOOGLEAPIS_HOST = "googleapis.com";

const tracer = opentelemetry.trace.getTracer("schedule");

/** Strip the API key from a URL before using it in logs or span attributes. */
function redactUrl(url: URL): string {
  const copy = new URL(url.toString());
  if (copy.searchParams.has("key")) {
    copy.searchParams.set("key", "REDACTED");
  }
  return copy.toString();
}

export interface CalendarMetadata {
  summary: string;
  timeZone: string;
}

export interface CalendarEventItem {
  id: string;
  summary?: string;
  status: "confirmed" | "tentative" | "cancelled";
  visibility?: "public" | "private" | "default" | "confidential";
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
) & { pageToken?: string; orderBy?: "startTime" | "updated"; maxResults?: number };

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
  constructor(
    private readonly apiKey: string,
    private readonly logger: Logger,
  ) {}

  async getCalendarMetadata(calendarId: string): Promise<CalendarMetadata> {
    // calendars.get requires OAuth2 even for public calendars; events.list works with API keys.
    // Fetch zero events — the response still includes summary and timeZone.
    return tracer.startActiveSpan(
      `GET ${GOOGLEAPIS_HOST} calendar metadata`,
      {
        kind: SpanKind.CLIENT,
        attributes: {
          "http.request.method": "GET",
          "server.address": GOOGLEAPIS_HOST,
          "http.route": "/calendar/v3/calendars/{id}/events",
          "calendar.operation": "metadata",
        },
      },
      async (span) => {
        const url = new URL(
          `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events`,
        );
        url.searchParams.set("key", this.apiKey);
        url.searchParams.set("maxResults", "1");
        url.searchParams.set("fields", "summary,timeZone");

        span.setAttribute("url.full", redactUrl(url));

        try {
          const response = await fetch(url.toString());
          span.setAttribute("http.response.status_code", response.status);

          if (!response.ok) {
            const err = new GoogleCalendarError(
              `Failed to get calendar metadata: ${response.statusText}`,
              response.status,
            );
            span.recordException(err);
            span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
            this.logger.error(
              { calendarId, statusCode: response.status, statusText: response.statusText },
              "Failed to get calendar metadata",
            );
            throw err;
          }

          const data = (await response.json()) as { summary?: string; timeZone?: string };
          return {
            summary: data.summary ?? "",
            timeZone: data.timeZone ?? "UTC",
          };
        } catch (err) {
          if (!(err instanceof GoogleCalendarError)) {
            // Network / parse error — GoogleCalendarError is already handled above
            span.recordException(err instanceof Error ? err : new Error(String(err)));
            span.setStatus({
              code: SpanStatusCode.ERROR,
              message: err instanceof Error ? err.message : String(err),
            });
            this.logger.error({ err, calendarId }, "Network error fetching calendar metadata");
          }
          throw err;
        } finally {
          span.end();
        }
      },
    );
  }

  async listEvents(
    calendarId: string,
    options: ListEventsOptions = {},
  ): Promise<ListEventsResponse> {
    return tracer.startActiveSpan(
      `GET ${GOOGLEAPIS_HOST} calendar events`,
      {
        kind: SpanKind.CLIENT,
        attributes: {
          "http.request.method": "GET",
          "server.address": GOOGLEAPIS_HOST,
          "http.route": "/calendar/v3/calendars/{id}/events",
          "calendar.operation": "list",
          "calendar.sync_type": options.syncToken ? "incremental" : "full",
        },
      },
      async (span) => {
        const allItems: CalendarEventItem[] = [];
        let nextSyncToken: string | undefined;
        let pageToken: string | undefined = options.pageToken;
        let pageCount = 0;
        let lastStatusCode: number | undefined;

        try {
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
              if (options.orderBy) url.searchParams.set("orderBy", options.orderBy);
              if (options.maxResults) url.searchParams.set("maxResults", String(options.maxResults));
            }

            if (pageToken) {
              url.searchParams.set("pageToken", pageToken);
            }

            // Only set url.full on the first page to avoid overwriting with paginated URLs
            if (pageCount === 0) {
              span.setAttribute("url.full", redactUrl(url));
            }

            const response = await fetch(url.toString());
            lastStatusCode = response.status;
            pageCount++;

            if (!response.ok) {
              span.setAttributes({
                "http.response.status_code": response.status,
                "calendar.pages_fetched": pageCount,
              });
              const err = new GoogleCalendarError(
                `Failed to list events: ${response.statusText}`,
                response.status,
              );
              span.recordException(err);
              span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
              this.logger.error(
                {
                  calendarId,
                  statusCode: response.status,
                  statusText: response.statusText,
                  pageCount,
                  syncType: options.syncToken ? "incremental" : "full",
                },
                "Failed to list calendar events",
              );
              throw err;
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

          span.setAttributes({
            "http.response.status_code": lastStatusCode ?? 200,
            "calendar.pages_fetched": pageCount,
            "calendar.items_fetched": allItems.length,
          });

          return { items: allItems, nextSyncToken };
        } catch (err) {
          if (!(err instanceof GoogleCalendarError)) {
            span.recordException(err instanceof Error ? err : new Error(String(err)));
            span.setStatus({
              code: SpanStatusCode.ERROR,
              message: err instanceof Error ? err.message : String(err),
            });
            this.logger.error(
              { err, calendarId, syncType: options.syncToken ? "incremental" : "full" },
              "Network error listing calendar events",
            );
          }
          throw err;
        } finally {
          span.end();
        }
      },
    );
  }
}

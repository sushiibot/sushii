/**
 * Domain-specific message data type that captures only the fields we actually need
 * for message logging, avoiding the complexity and casting issues with APIMessage.
 */
export interface MessageData {
  id: string;
  channel_id: string;
  author: {
    id: string;
    username: string;
    discriminator: string;
    avatar: string | null;
    bot: boolean;
    global_name: string | null;
  };
  content: string;
  timestamp: string;
  sticker_items?: {
    id: string;
    name: string;
    format_type: number;
  }[];
  attachments?: {
    id: string;
    filename: string;
    size: number;
    url: string;
    proxy_url: string;
    width?: number | null;
    height?: number | null;
    content_type?: string;
  }[];
  referenced_message?: {
    id: string;
    author: {
      id: string;
    };
  };
}
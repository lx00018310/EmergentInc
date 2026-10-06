export interface Site {
  site_name: string; headline_en: string; headline_zh: string; description_en: string; description_zh: string;
  github_url: string; contact_text_en: string; contact_text_zh: string;
}
export interface Product {
  product_id: string; product_name_en: string; product_name_zh: string;
  product_description_en: string; product_description_zh: string; product_price: string; product_currency: 'USDT';
}
export interface Payment {
  order_id: string; status: string; invoice_status: string; chain: string; amount: string;
  quoted_amount: string; currency: string; recipient_address: string; token_contract: string;
  qr_payload: string; wallet_url: string | null; expires_at: number; paid_at: number | null;
  qr_data_url: string;
}
export class PublicApiError extends Error { constructor(message: string, readonly status: number) { super(message); } }
export async function publicApi<T>(path: string, body?: unknown, token?: string): Promise<T> {
  const response = await fetch(`/api/public/${path}`, body === undefined ? { headers: token ? { Authorization: `Bearer ${token}` } : {} } : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) throw new PublicApiError(result.detail, response.status);
  return result;
}

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Checkout } from '../src/features/public/Checkout';
import { PublicApp } from '../src/features/public/PublicApp';
import { PublicSiteSettings } from '../src/features/business/PublicSiteSettings';
import { setLanguage } from '../src/i18n';

const product = { product_id: 'custom-service', product_name_en: 'Custom Service', product_name_zh: '定制服务', product_description_en: 'Help deploy your business', product_description_zh: '帮助部署生意', product_price: '10.000000', product_currency: 'USDT' as const };
const order = { order_id: 'order_12345678-1234-1234-1234-123456789abc', public_order_token: 'a'.repeat(64) };
const payment = { order_id: order.order_id, invoice_status: 'WAITING', status: 'AWAITING_PAYMENT', chain: 'tron', amount: '10.000001', quoted_amount: '10.000000', currency: 'USDT',
  recipient_address: 'test-address', token_contract: 'test-token', qr_payload: 'test-address', qr_data_url: 'data:image/png;base64,a', wallet_url: null, expires_at: Date.now() + 86400000, paid_at: null };
const response = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body, headers: new Headers({ 'Content-Type': 'application/json' }) }) as Response;
afterEach(() => { cleanup(); vi.restoreAllMocks(); sessionStorage.clear(); window.history.replaceState(null, '', '/'); });
function fill() {
  fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Ada' } });
  fireEvent.change(screen.getByLabelText('Email or other contact'), { target: { value: 'ada@example.com' } });
  fireEvent.change(screen.getByLabelText('What would you like to build?'), { target: { value: 'Deploy a business' } });
  fireEvent.submit(screen.getByRole('button', { name: 'Create order and USDT invoice' }).closest('form')!);
}
describe('V24 checkout and Owner product settings', () => {
  it('creates an invoice, sends no client price, queries with a bearer token and preserves an uncertain request through remount', async () => {
    setLanguage('en'); let lost = true;
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      if (String(input).endsWith('payment-rails')) return response({ items: [{ rail_id: 'tron', chain: 'tron', asset: 'USDT' }] });
      if (String(input).endsWith('/orders')) { if (lost) throw Error('TEST_CONNECTION_LOST'); return response(order, 201); }
      expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer ' + order.public_order_token);
      return response(payment);
    });
    const view = render(<Checkout product={product} />); await screen.findByRole('option', { name: 'TRON · TRC-20 USDT' }); fill();
    expect(await screen.findByRole('alert')).toBeTruthy();
    const firstBody = String(fetch.mock.calls.find(([input]) => String(input).endsWith('/orders'))![1]!.body);
    expect(JSON.parse(firstBody)).not.toHaveProperty('amount'); expect(JSON.parse(firstBody)).not.toHaveProperty('price');
    view.unmount(); lost = false; render(<Checkout product={product} />);
    fireEvent.click(screen.getByRole('button', { name: 'Retry order request' }));
    expect(await screen.findByText('10.000001 USDT')).toBeTruthy(); expect(screen.getByRole('img', { name: 'Payment QR code' })).toBeTruthy();
    const requests = fetch.mock.calls.filter(([input]) => String(input).endsWith('/orders'));
    expect(requests[1]![1]!.body).toBe(firstBody); expect(window.location.hash).toContain(order.public_order_token); expect(sessionStorage.getItem('emergentinc.checkout-intent')).toBeNull();
    await act(async () => setLanguage('zh-CN'));
    expect(screen.getByText('实际应付金额')).toBeTruthy(); expect(screen.getByText(/TRON 二维码仅包含/)).toBeTruthy();
  });
  it('allows correcting a definitively rejected request and keeps the entered customer details', async () => {
    setLanguage('en'); vi.spyOn(globalThis, 'fetch').mockImplementation(async input => String(input).endsWith('payment-rails') ?
      response({ items: [{ rail_id: 'tron', chain: 'tron', asset: 'USDT' }] }) : response({ detail: 'INVALID_CHECKOUT_INPUT' }, 400));
    render(<Checkout product={product} />); await screen.findByRole('option'); fill();
    await screen.findByRole('alert');
    expect((screen.getByLabelText('Your name') as HTMLInputElement).value).toBe('Ada'); expect(sessionStorage.getItem('emergentinc.checkout-intent')).toBeNull();
  });
  it('restores a paid order from its private link even after the product is delisted', async () => {
    setLanguage('en'); window.history.replaceState(null, '', '/#order=' + order.order_id + '&token=' + order.public_order_token);
    vi.spyOn(globalThis, 'fetch').mockImplementation(async input => String(input).endsWith('/site') ? response({ site_name: 'EmergentInc', headline_en: 'Store', headline_zh: '官网', description_en: 'Business', description_zh: '生意', github_url: '', contact_text_en: '', contact_text_zh: '' }) :
      String(input).endsWith('/products') ? response({ items: [] }) : response({ ...payment, invoice_status: 'PAID', status: 'PAID' }));
    render(<PublicApp />);
    expect(await screen.findByText('Payment received. We will contact you using your order details.')).toBeTruthy();
    expect(screen.queryByRole('img', { name: 'Payment QR code' })).toBeNull(); expect(screen.queryByRole('button', { name: 'Create order and USDT invoice' })).toBeNull();
  });
  it('edits the actual Owner site, price and listing without submitting order data or internal metadata', async () => {
    setLanguage('en');
    const settings = { ...product, product_enabled: 1, site_name: 'EmergentInc', headline_en: 'Business', headline_zh: '生意', description_en: 'Description', description_zh: '介绍',
      github_url: '', contact_text_en: 'Contact', contact_text_zh: '联系', updated_at: Date.now() };
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => response({ settings, products:[{...product,product_enabled:1}], rails: [], revenue: { mainnetAtomic: '10000001', byChain: [] }, orders: [] }));
    render(<PublicSiteSettings />); await screen.findByLabelText('Price (USDT)');
    fireEvent.change(screen.getByLabelText('Price (USDT)'), { target: { value: '25.5' } });
    fireEvent.click(screen.getByLabelText('Product available for purchase'));
    fireEvent.submit(screen.getByRole('button', { name: 'Save product' }).closest('form')!);
    await screen.findByText('Product saved.');
    const request = fetch.mock.calls.find(([, init]) => init?.method === 'PUT')!;
    expect(JSON.parse(String(request[1]!.body))).toMatchObject({ product_enabled: false, product_price: '25.5', product_currency: 'USDT' });
    expect(JSON.parse(String(request[1]!.body))).not.toHaveProperty('product_id'); expect(JSON.parse(String(request[1]!.body))).not.toHaveProperty('updated_at');
    await waitFor(() => expect(screen.getByText('10.000001 USDT')).toBeTruthy());
  });
});

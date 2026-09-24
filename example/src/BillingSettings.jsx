// Billing settings: payment method, invoices, and plan preferences.
export function BillingSettings() {
  return (
    <main>
      <h1>Billing</h1>
      <p>Manage the card you pay with, download invoices, and choose where receipts go.</p>
      <p role="alert">
        We couldn't charge your Visa ending in 4242. Update the card below or add a
        different payment method to keep your plan active.
      </p>

      <h2>Payment method</h2>
      <p>Visa ending in 4242</p>
      <button type="button">Update card</button>
      <button type="button">Remove card…</button>
      <p>You'll be asked to confirm before the card is removed.</p>

      <h2>Invoices</h2>
      <p>No invoices yet. Your first invoice will appear here after your first payment.</p>

      <h2>Receipts</h2>
      <label htmlFor="billing-email">Send receipts to</label>
      <input id="billing-email" type="email" />
      <button type="button" data-variant="primary">Save receipt email</button>
      <button type="button">Cancel</button>
    </main>
  );
}

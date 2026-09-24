// Billing settings: payment method, invoices, and plan preferences.
export function BillingSettings() {
  return (
    <section>
      <h2>Billing</h2>
      <p role="alert">Something went wrong.</p>

      <h3>Payment method</h3>
      <p>Visa ending in 4242</p>
      <button type="button">Remove</button>

      <h3>Invoices</h3>
      <p>No invoices.</p>

      <h3>Preferences</h3>
      <label htmlFor="billing-email">Billing email</label>
      <input id="billing-email" type="email" />
      <button type="button">Save</button>
      <button type="button">Save changes</button>
      <button type="button">Apply</button>
    </section>
  );
}

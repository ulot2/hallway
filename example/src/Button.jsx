// Shared component. Nothing imports it from a story file directly, which is the
// point: changing this file must still pull in every story that renders it.
export function Button({ children, variant = 'secondary', ...rest }) {
  return (
    <button type="button" data-variant={variant} {...rest}>
      {children}
    </button>
  );
}

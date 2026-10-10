/** Account routes reuse the original admin CSS without emitting browser-side JS CSS loaders. */
export default function AccountStyleLoader() {
  return <link rel="stylesheet" href="/account-admin.css" precedence="default"/>;
}

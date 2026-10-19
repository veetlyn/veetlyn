export default function JsonLd({ data }: { data: object }) {
  // JSON.stringify escapes nothing HTML-specific; "<" is escaped so a string can never close the script tag.
  return (
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replaceAll("<", "\\u003c") }} />
  );
}

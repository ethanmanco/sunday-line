import Link from "next/link";

export default function NotFound() {
  return (
    <div className="page">
      <h1>Not found</h1>
      <p>That road or page isn&apos;t here. It may have been removed in a data update.</p>
      <p><Link href="/">Back to all roads</Link></p>
    </div>
  );
}

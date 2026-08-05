import type { Property } from "../services/properties.service";

export function PropertyList({ properties }: { properties: Property[] }) {
  return (
    <section>
      <h1 className="text-xl font-semibold">Properties</h1>
      <ul className="mt-4 divide-y divide-gray-200">
        {properties.length === 0 && (
          <li className="py-3 text-gray-500">No properties yet.</li>
        )}
        {properties.map((p) => (
          <li key={p.id} className="py-3">
            <span className="font-medium">{p.name}</span>{" "}
            <span className="text-gray-500">({p.internalCode})</span> — {p.city}
            , {p.state}
          </li>
        ))}
      </ul>
    </section>
  );
}

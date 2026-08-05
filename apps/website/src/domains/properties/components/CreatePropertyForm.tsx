import { createPropertyAction } from "../actions";

export function CreatePropertyForm() {
  return (
    <section>
      <h2 className="text-lg font-semibold">Add property</h2>
      <form action={createPropertyAction} className="mt-4 grid max-w-lg gap-3">
        <input
          name="name"
          placeholder="Name"
          required
          className="rounded border px-3 py-2"
        />
        <input
          name="internalCode"
          placeholder="Internal code"
          required
          className="rounded border px-3 py-2"
        />
        <input
          name="addressLine1"
          placeholder="Address line 1"
          required
          className="rounded border px-3 py-2"
        />
        <div className="grid grid-cols-3 gap-3">
          <input
            name="city"
            placeholder="City"
            required
            className="rounded border px-3 py-2"
          />
          <input
            name="state"
            placeholder="State"
            required
            className="rounded border px-3 py-2"
          />
          <input
            name="postalCode"
            placeholder="Postal code"
            required
            className="rounded border px-3 py-2"
          />
        </div>
        <input
          name="country"
          placeholder="Country"
          required
          className="rounded border px-3 py-2"
        />
        <select
          name="propertyType"
          required
          className="rounded border px-3 py-2"
        >
          <option value="HOUSE">House</option>
          <option value="APARTMENT">Apartment</option>
          <option value="CONDO">Condo</option>
          <option value="CABIN">Cabin</option>
          <option value="OTHER">Other</option>
        </select>
        <div className="grid grid-cols-3 gap-3">
          <input
            name="bedroomCount"
            type="number"
            min={0}
            placeholder="Bedrooms"
            required
            className="rounded border px-3 py-2"
          />
          <input
            name="bathroomCount"
            type="number"
            min={0}
            step={0.5}
            placeholder="Bathrooms"
            required
            className="rounded border px-3 py-2"
          />
          <input
            name="maxOccupancy"
            type="number"
            min={1}
            placeholder="Max occupancy"
            required
            className="rounded border px-3 py-2"
          />
        </div>
        <input
          name="timezone"
          placeholder="Timezone (e.g. America/Denver)"
          required
          className="rounded border px-3 py-2"
        />
        <button
          type="submit"
          className="mt-2 rounded bg-brand-600 px-4 py-2 text-white hover:bg-brand-700"
        >
          Create property
        </button>
      </form>
    </section>
  );
}

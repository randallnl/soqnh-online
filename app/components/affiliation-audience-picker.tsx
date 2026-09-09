import { useState } from "react";

import type { PostAffiliationOption } from "~/models/posts.server";

export function AffiliationAudiencePicker({
	affiliations,
	defaultSelectedIds = [],
}: {
	affiliations: PostAffiliationOption[];
	defaultSelectedIds?: string[];
}) {
	const [selectedIds, setSelectedIds] = useState(defaultSelectedIds);
	const setSelected = (affiliationId: string, selected: boolean) => {
		setSelectedIds((current) => selected
			? [...new Set([...current, affiliationId])]
			: current.filter((id) => id !== affiliationId));
	};

	return <div>
		<label><input checked={selectedIds.length === 0} name="ecosystemWide" onChange={() => setSelectedIds([])} type="checkbox" value="true" />Ecosystem-wide</label>
		{affiliations.map((affiliation) => <label key={affiliation.id}><input checked={selectedIds.includes(affiliation.id)} name="affiliationId" onChange={(event) => setSelected(affiliation.id, event.currentTarget.checked)} type="checkbox" value={affiliation.id} />{affiliation.name}</label>)}
	</div>;
}

# condo — ngdpbase add-on

A condominium's units, keyed by the county parcel, and their owners. The Fairways Condominiums is
the reference site. Work is tracked in epic
[#9](https://github.com/jwilleke/ngdpbase-addons/issues/9).

## Enable

In the site's `app-custom-config.json`:

```json
{
  "ngdpbase.managers.addons-manager.addons-path": ["./addons", "/path/to/ngdpbase-addons/addons"],
  "ngdpbase.addons.condo.enabled": true
}
```

Then `npm run build` here and restart ngdpbase.

## Develop

```bash
npm install
npm test        # builds, then runs vitest
```

Add-on rules: ngdpbase `docs/guides/addons-developer-guide.md`.

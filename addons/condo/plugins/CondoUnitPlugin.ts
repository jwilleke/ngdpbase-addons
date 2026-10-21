/**
 * [{CondoUnit}] — a condo unit's card on any page.
 *
 * Skeleton only: the card arrives with
 * https://github.com/jwilleke/ngdpbase-addons/issues/7.
 */
import type { PluginFormatters } from '@jwilleke/ngdpbase-types';

interface PluginContext {
  formatters: Pick<PluginFormatters, 'escapeHtml'>;
}

const CondoUnitPlugin = {
  name: 'CondoUnit',
  description: 'A condo unit card',
  author: 'jwilleke',
  version: '0.1.0',

  execute(context: PluginContext, params: Record<string, string>): string {
    const unit = context.formatters.escapeHtml(params.unit ?? '');
    return `<span class="condo-unit">Unit ${unit}</span>`;
  }
};

export default CondoUnitPlugin;

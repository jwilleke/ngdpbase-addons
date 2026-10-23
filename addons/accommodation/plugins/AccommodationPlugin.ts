/**
 * [{Accommodation}] — an accommodation's card on any page.
 *
 * Skeleton only: the card arrives with
 * https://github.com/jwilleke/ngdpbase-addons/issues/7.
 */
import type { PluginFormatters } from '@jwilleke/ngdpbase-types';

interface PluginContext {
  formatters: Pick<PluginFormatters, 'escapeHtml'>;
}

const AccommodationPlugin = {
  name: 'Accommodation',
  description: 'An accommodation card',
  author: 'jwilleke',
  version: '0.1.0',

  execute(context: PluginContext, params: Record<string, string>): string {
    const id = context.formatters.escapeHtml(params.id ?? '');
    return `<span class="accommodation">Accommodation ${id}</span>`;
  }
};

export default AccommodationPlugin;

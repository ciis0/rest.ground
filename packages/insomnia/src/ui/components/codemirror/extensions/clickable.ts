import 'codemirror/addon/mode/overlay';

import CodeMirror, { CodeMirrorLinkClickCallback } from 'codemirror';
import { AllHtmlEntities } from 'html-entities';

import { FLEXIBLE_URL_REGEX } from '../../../../common/constants';
const entities = new AllHtmlEntities();

CodeMirror.defineExtension('makeLinksClickable', function(handleClick: CodeMirrorLinkClickCallback) {
  // Only add the click mode if we have links to click
  this.addOverlay({
    token: function(stream: any) {
      if (stream.match(FLEXIBLE_URL_REGEX, true)) {
        return 'clickable';
      }

      while (stream.next() != null) {
        if (stream.match(FLEXIBLE_URL_REGEX, false)) {
          break;
        }
      }

      return null;
    },
  });

  const el: HTMLElement = this.getWrapperElement();
  let movedDuringClick = false;
  el.addEventListener('mousemove', () => {
    movedDuringClick = true;
  });
  el.addEventListener('mousedown', () => {
    movedDuringClick = false;
  });
  el.addEventListener('mouseup', event => {
    if (movedDuringClick) {
      return;
    }

    // @ts-expect-error -- type unsoundness
    const cls = event.target.className;

    if (cls.indexOf('cm-clickable') >= 0) {
      // @ts-expect-error -- mapping unsoundness
      handleClick(entities.decode(event.target.innerHTML));
    }
  });
});

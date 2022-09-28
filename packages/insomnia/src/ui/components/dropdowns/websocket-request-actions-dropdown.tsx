import React, { forwardRef, useCallback } from 'react';
import { useSelector } from 'react-redux';

import * as requestOperations from '../../../models/helpers/request-operations';
import { incrementDeletedRequests } from '../../../models/stats';
import { WebSocketRequest } from '../../../models/websocket-request';
import { updateRequestMetaByParentId } from '../../hooks/create-request';
import { selectHotKeyRegistry } from '../../redux/selectors';
import { type DropdownHandle, type DropdownProps, Dropdown } from '../base/dropdown/dropdown';
import { DropdownButton } from '../base/dropdown/dropdown-button';
import { DropdownDivider } from '../base/dropdown/dropdown-divider';
import { DropdownHint } from '../base/dropdown/dropdown-hint';
import { DropdownItem } from '../base/dropdown/dropdown-item';
import { PromptButton } from '../base/prompt-button';

interface Props extends Pick<DropdownProps, 'right'> {
  handleDuplicateRequest: Function;
  isPinned: Boolean;
  request: WebSocketRequest;
  handleShowSettings: () => void;
}

export const WebSocketRequestActionsDropdown = forwardRef<DropdownHandle, Props>(({
  handleDuplicateRequest,
  isPinned,
  handleShowSettings,
  request,
  right,
}, ref) => {
  const hotKeyRegistry = useSelector(selectHotKeyRegistry);

  const duplicate = useCallback(() => {
    handleDuplicateRequest(request);
  }, [handleDuplicateRequest, request]);

  const togglePin = useCallback(() => {
    updateRequestMetaByParentId(request._id, { pinned: !isPinned });
  }, [isPinned, request]);

  const deleteRequest = useCallback(() => {
    incrementDeletedRequests();
    requestOperations.remove(request);
  }, [request]);

  return (
    <Dropdown right={right} ref={ref}>
      <DropdownButton>
        <i className="fa fa-caret-down" />
      </DropdownButton>

      <DropdownItem onClick={duplicate}>
        <i className="fa fa-copy" /> Duplicate
        <DropdownHint keyBindings={hotKeyRegistry.request_showDuplicate} />
      </DropdownItem>

      <DropdownItem onClick={togglePin}>
        <i className="fa fa-thumb-tack" /> {isPinned ? 'Unpin' : 'Pin'}
        <DropdownHint keyBindings={hotKeyRegistry.request_togglePin} />
      </DropdownItem>

      <DropdownItem
        buttonClass={PromptButton}
        onClick={deleteRequest}
        addIcon
      >
        <i className="fa fa-trash-o" /> Delete
        <DropdownHint keyBindings={hotKeyRegistry.request_showDelete} />
      </DropdownItem>

      <DropdownDivider />

      <DropdownItem onClick={handleShowSettings}>
        <i className="fa fa-wrench" /> Settings
        <DropdownHint keyBindings={hotKeyRegistry.request_showSettings} />
      </DropdownItem>
    </Dropdown>
  );
});

WebSocketRequestActionsDropdown.displayName = 'WebSocketRequestActionsDropdown';

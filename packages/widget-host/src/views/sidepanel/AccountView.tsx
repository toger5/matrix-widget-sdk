import type { CSSProperties } from "react";

import type { AccountId, AccountViewModel } from "../../appViewModel";
import { useDispatch } from "../env";
import { Avatar, Button, DevAvatar, Icon, type IconName } from "../ui/atoms";
import { DeviceVerification, verificationRunning } from "./DeviceVerification";
import { SideBox } from "./SideBox";

export interface AccountViewProps {
  accounts: AccountViewModel[];
  activeAccountId: AccountId;
  /** Story only: the recovery key the verification form starts with. */
  initialRecoveryKey?: string;
}

const nameOf = (a: AccountViewModel) => a.displayName || a.userId;

function UserAvatar({ account, size }: { account: AccountViewModel; size: number }) {
  return <Avatar name={nameOf(account)} id={account.userId} size={size} mxc={account.avatarUrl} />;
}

function MenuRow({ icon, label, end, className = "", onClick }: { icon: IconName; label: string; end?: IconName; className?: string; onClick: () => void }) {
  return (
    <button type="button" className={`menu-row ${className}`} onClick={onClick}>
      <Icon name={icon} size={16} />
      <span>{label}</span>
      {end && <Icon name={end} size={14} className="end" />}
    </button>
  );
}

/** The state of an account that is not simply usable: a small marker in the lists. */
function StatusMark({ account }: { account: AccountViewModel }) {
  // TODO-FINDING account-status-markers - the design shows no account states in the switch list / account list. Rendered as small pills ("paused", "Restoring…", "restore failed") after the name.
  if (account.status === "suspended") return <span className="pill acc-mark">paused</span>;
  if (account.status === "restoring") return <span className="pill acc-mark">Restoring…</span>;
  if (account.status === "restoreFailed")
    return (
      <span className="pill acc-mark failed" title={account.error}>
        <Icon name="alert" size={11} />
        restore failed
      </span>
    );
  return null;
}

function AddAccountRow() {
  const dispatch = useDispatch();
  return (
    <button type="button" className="switch-acc add" onClick={() => dispatch({ type: "account/add" })}>
      <span className="av ghost" style={{ "--s": "30px" } as CSSProperties} aria-hidden="true">
        <Icon name="userPlus" size={14} />
      </span>
      <span className="switch-txt">
        <b>Add account</b>
      </span>
      <Icon name="external" size={14} className="end" />
    </button>
  );
}

function SwitchRow({ account }: { account: AccountViewModel }) {
  const dispatch = useDispatch();
  return (
    <button type="button" className="switch-acc" data-account-id={account.id} onClick={() => dispatch({ type: "account/switch", accountId: account.id })}>
      <UserAvatar account={account} size={30} />
      <span className="switch-txt">
        <small>switch to</small>
        <b>{nameOf(account)}</b>
        <em>{account.userId}</em>
      </span>
      <StatusMark account={account} />
      <Icon name="arrowRight" size={16} className="end" />
    </button>
  );
}

/** The DevBackend in the switch list of a Matrix account, while it is enabled: switching to it activates it (confirmed if room panels are open). story `sidepanel-accountview--several-accounts` */
function DevSwitchRow({ account }: { account: AccountViewModel }) {
  const dispatch = useDispatch();
  return (
    <button type="button" className="switch-acc" data-account-id={account.id} onClick={() => dispatch({ type: "account/switch", accountId: account.id })}>
      <DevAvatar size={30} />
      <span className="switch-txt">
        <small>switch to</small>
        <b>DevBackend</b>
        <em>mocked rooms, no homeserver</em>
      </span>
      <Icon name="arrowRight" size={16} className="end" />
    </button>
  );
}

/** The DevBackend is the active account: its card and the full list of Matrix accounts. story `sidepanel-accountview--dev-backend-mode` */
function DevAccountBody({ account, others }: { account: AccountViewModel; others: AccountViewModel[] }) {
  const dispatch = useDispatch();
  return (
    <>
      <div className="acc-card dev">
        <DevAvatar size={44} />
        <div>
          <b>{account.displayName ?? "DevBackend"}</b>
          <small>{account.userId}</small>
          <span className="pill dev">in-memory · no Matrix requests</span>
        </div>
      </div>
      {/* TODO-FINDING devbackend-account-actions - the design offers no "Copy Matrix URI" and no "Log out" for the DevBackend account (there is nothing to log out of); none are rendered. */}
      {/* TODO-FINDING devbackend-no-matrix-account - after "skip login" there is no Matrix account to switch to; the hint then says "Add a Matrix account to leave it". */}
      <p className="hint">
        {others.length
          ? "The DevBackend is its own account. Switch to one of your Matrix accounts to leave it. The mocked rooms are kept."
          : "The DevBackend is its own account. Add a Matrix account to leave it. The mocked rooms are kept."}
      </p>
      <h4 className="side-h">Accounts</h4>
      <div className="acc-list">
        {others.map((a) => (
          <div key={a.id} className="acc-item" data-account-id={a.id}>
            <div className="acc-line">
              <UserAvatar account={a} size={30} />
              <span className="switch-txt">
                <b>{nameOf(a)}</b>
                <em>{a.userId}</em>
              </span>
              <StatusMark account={a} />
            </div>
            <Button block end="arrowRight" onClick={() => dispatch({ type: "account/switch", accountId: a.id })}>
              Switch to {nameOf(a)}
            </Button>
          </div>
        ))}
        <div className="acc-list-end">
          <AddAccountRow />
        </div>
      </div>
    </>
  );
}

function MatrixAccountBody({ account, others, dev, initialRecoveryKey }: { account: AccountViewModel; others: AccountViewModel[]; dev?: AccountViewModel; initialRecoveryKey?: string }) {
  const dispatch = useDispatch();
  const accountId = account.id;
  const hasDetails = !!account.homeserver || !!account.deviceId || account.verified !== undefined;
  // While a verification step runs, its box replaces the details and the menu.
  const running = verificationRunning(account.verification);
  const verifyBox = running || account.verification?.step === "done" || account.verified === false;
  return (
    <>
      <div className="acc-card">
        <UserAvatar account={account} size={56} />
        <div>
          <b>{nameOf(account)}</b>
          <small>{account.userId}</small>
        </div>
      </div>
      {account.status === "restoring" && (
        <p className="acc-note" role="status">
          <Icon name="clock" size={14} />
          Restoring…
        </p>
      )}
      {account.status === "restoreFailed" && (
        <div className="acc-error" role="alert">
          <Icon name="alert" size={14} />
          <span>
            <b>This account could not be restored.</b>
            {account.error && <small>{account.error}</small>}
          </span>
        </div>
      )}
      {verifyBox && <DeviceVerification accountId={accountId} userId={account.userId} verification={account.verification} initialRecoveryKey={initialRecoveryKey} />}
      {hasDetails && !running && (
        <dl className="kv">
          {account.homeserver && (
            <>
              <dt>Homeserver</dt>
              <dd>{account.homeserver}</dd>
            </>
          )}
          {account.deviceId && (
            <>
              <dt>Device</dt>
              <dd className="mono">{account.deviceId}</dd>
            </>
          )}
          {account.verified !== undefined && (
            <>
              <dt>Verified</dt>
              <dd>
                {account.verified ? (
                  <span className="ok-text">
                    <Icon name="shield" size={13} /> This device is verified
                  </span>
                ) : (
                  <span className="acc-unverified">
                    <Icon name="alert" size={13} /> This device is not verified
                  </span>
                )}
              </dd>
            </>
          )}
        </dl>
      )}
      {!running && (
        <div className="menu">
          {/* TODO-FINDING restore-failed-actions - a failed restore adds "Try again" as the first menu row and keeps the one "Log out" row of the menu, instead of a second pair of buttons next to the error (two "Log out" buttons would be ambiguous for tests and screen readers). */}
          {account.status === "restoreFailed" && <MenuRow icon="refresh" label="Try again" onClick={() => dispatch({ type: "account/retryRestore", accountId })} />}
          {account.manageUrl && <MenuRow icon="monitor" label="Manage account & devices" end="external" onClick={() => dispatch({ type: "account/manage", accountId })} />}
          <MenuRow icon="copy" label="Copy Matrix URI" onClick={() => dispatch({ type: "account/copyMatrixUri", accountId })} />
          <MenuRow icon="logout" label="Log out" className="danger" onClick={() => dispatch({ type: "account/logout", accountId })} />
        </div>
      )}
      <span className="sp" />
      <div className="switch-list">
        {others.map((a) => (
          <SwitchRow key={a.id} account={a} />
        ))}
        {dev && <DevSwitchRow account={dev} />}
        <AddAccountRow />
      </div>
    </>
  );
}

/** stories `sidepanel-accountview--one-account`, `sidepanel-accountview--several-accounts`, `sidepanel-accountview--dev-backend-mode`; with the "Verify this device" box `sidepanel-deviceverification--*`. */
export function AccountView({ accounts, activeAccountId, initialRecoveryKey }: AccountViewProps) {
  const active = accounts.find((a) => a.id === activeAccountId);
  const others = accounts.filter((a) => a.id !== activeAccountId && a.kind === "matrix");
  // Listed while the DevBackend is enabled.
  const devAccount = accounts.find((a) => a.kind === "devBackend");
  const dev = active?.kind === "devBackend";
  return (
    <SideBox title="Account" className={dev ? "acc-dev" : "acc"} testId="account-view">
      {active && (dev ? <DevAccountBody account={active} others={others} /> : <MatrixAccountBody account={active} others={others} dev={devAccount} initialRecoveryKey={initialRecoveryKey} />)}
    </SideBox>
  );
}

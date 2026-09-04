import { useEffect, useState } from 'react';
import { Button, Input, Select, Space, Tag, App, Modal, Empty, Spin, Popconfirm, Alert } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { selfApi } from './selfApi';
import { useSelfT, REQUEST_TYPE_KEYS } from './selfI18n';
import { useSelf } from './SelfApp';

const STATUS_COLOR: Record<string, string> = {
  PENDING: 'orange', APPROVED: 'green', REJECTED: 'red', CANCELLED: 'default', DONE: 'blue',
};

/** 申请：调宿 / 退宿 / 夫妻房 / 访客留宿 / 加床 */
export default function SelfRequests() {
  const { t, status, reqType } = useSelfT();
  const { reload } = useSelf();
  const { message } = App.useApp();
  const [rows, setRows] = useState<any[] | null>(null);
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<string>('TRANSFER');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  const load = () => selfApi.requests().then(setRows);
  useEffect(() => { load(); }, []);

  const submit = async () => {
    if (!reason.trim()) return message.warning(t('reasonHint'));
    setSaving(true);
    try {
      const r = await selfApi.createRequest({ type, reason: reason.trim() });
      message.success(`${t('success')} · ${r.code}`);
      setOpen(false); setReason('');
      load(); reload();
    } catch (e: any) {
      // 夫妻房这类有前置条件的，后端会带 hint 说明该怎么办
      Modal.warning({ title: e.message, content: e.body?.hint });
    } finally { setSaving(false); }
  };

  return (
    <div>
      <Button type="primary" size="large" block icon={<PlusOutlined />}
        onClick={() => setOpen(true)} style={{ marginBottom: 12 }}>
        {t('newRequest')}
      </Button>

      <div className="self-card-title" style={{ padding: '0 4px' }}>{t('myRequests')}</div>

      {rows === null ? <div className="self-center"><Spin /></div>
        : rows.length === 0 ? <div className="self-card"><Empty description={t('noRequests')} /></div>
        : rows.map((r) => (
          <div className="self-row" key={r.id}>
            <div className="self-row-top">
              <div className="self-row-title">{reqType(r.type)}</div>
              <Tag color={STATUS_COLOR[r.status]}>{status(r.status)}</Tag>
            </div>
            <div className="self-row-meta">
              {r.code} · {new Date(r.submittedAt).toLocaleDateString()}<br />
              {r.reason}
              {r.comment && <><br /><span style={{ color: '#cf1322' }}>{r.comment}</span></>}
            </div>
            {r.status === 'PENDING' && (
              <div style={{ marginTop: 8 }}>
                <Popconfirm title={t('cancelConfirm')} onConfirm={async () => {
                  await selfApi.cancelRequest(r.id);
                  message.success(t('success'));
                  load(); reload();
                }}>
                  <Button size="small" danger>{t('cancel')}</Button>
                </Popconfirm>
              </div>
            )}
          </div>
        ))}

      <Modal
        open={open} title={t('newRequest')} onCancel={() => setOpen(false)}
        onOk={submit} confirmLoading={saving} okText={t('submit')}
        styles={{ body: { paddingTop: 8 } }}
      >
        <Space direction="vertical" style={{ width: '100%' }} size={14}>
          <div>
            <div style={{ fontSize: 13, color: '#595959', marginBottom: 6 }}>{t('requestType')}</div>
            <Select size="large" style={{ width: '100%' }} value={type} onChange={setType}
              options={REQUEST_TYPE_KEYS.map((k) => ({ value: k, label: reqType(k) }))} />
          </div>
          {type === 'COUPLE_ROOM' && (
            <Alert type="info" showIcon style={{ fontSize: 12 }}
              message="申请夫妻房需要先在宿管室登记并核验配偶关系（带结婚证）。" />
          )}
          <div>
            <div style={{ fontSize: 13, color: '#595959', marginBottom: 6 }}>{t('reason')}</div>
            <Input.TextArea rows={4} value={reason} placeholder={t('reasonHint')}
              onChange={(e) => setReason(e.target.value)} />
          </div>
        </Space>
      </Modal>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { Button, Input, Select, Space, Tag, App, Modal, Rate, Empty, Spin } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { selfApi } from './selfApi';
import { useSelfT } from './selfI18n';
import { useSelf } from './SelfApp';

const STATUS_COLOR: Record<string, string> = {
  NEW: 'red', ASSIGNED: 'orange', IN_PROGRESS: 'blue', DONE: 'green', CLOSED: 'default', REJECTED: 'default',
};

/** 报修：提交 + 看进度 + 完成后评价 */
export default function SelfRepair() {
  const { t, status, dict } = useSelfT();
  const { reload } = useSelf();
  const { message } = App.useApp();
  const [rows, setRows] = useState<any[] | null>(null);
  const [cats, setCats] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<{ categoryId?: number; title: string; description: string }>({ title: '', description: '' });
  const [saving, setSaving] = useState(false);

  const load = () => selfApi.workOrders().then(setRows);
  useEffect(() => {
    load();
    selfApi.meta().then((m) => setCats(m.workOrderCategories));
  }, []);

  const submit = async () => {
    if (!form.categoryId) return message.warning(t('repairCategory'));
    if (!form.title.trim()) return message.warning(t('repairTitleHint'));
    setSaving(true);
    try {
      const r = await selfApi.createWorkOrder({
        categoryId: form.categoryId, title: form.title.trim(), description: form.description.trim() || undefined,
      });
      message.success(`${t('success')} · ${r.code}`);
      setOpen(false);
      setForm({ title: '', description: '' });
      load(); reload();
    } catch (e: any) {
      message.error(e.message);
    } finally { setSaving(false); }
  };

  return (
    <div>
      <Button type="primary" size="large" block icon={<PlusOutlined />}
        onClick={() => setOpen(true)} style={{ marginBottom: 12 }}>
        {t('reportRepair')}
      </Button>

      <div className="self-card-title" style={{ padding: '0 4px' }}>{t('myRepairs')}</div>

      {rows === null ? <div className="self-center"><Spin /></div>
        : rows.length === 0 ? <div className="self-card"><Empty description={t('noRepairs')} /></div>
        : rows.map((w) => (
          <div className="self-row" key={w.id}>
            <div className="self-row-top">
              <div className="self-row-title">{w.title}</div>
              <Tag color={STATUS_COLOR[w.status]}>{status(w.status)}</Tag>
            </div>
            <div className="self-row-meta">
              {w.code} · {dict(w.category)}<br />
              {new Date(w.reportedAt).toLocaleString()}
              {' · '}{t('dueIn')} {w.slaHours} {t('hours')}
            </div>
            {['DONE', 'CLOSED'].includes(w.status) && (
              <div style={{ marginTop: 8 }}>
                {w.rating ? (
                  <Space size={6}>
                    <span style={{ fontSize: 12, color: '#8c8c8c' }}>{t('rated')}</span>
                    <Rate disabled value={w.rating} style={{ fontSize: 14 }} />
                  </Space>
                ) : (
                  <Space size={6}>
                    <span style={{ fontSize: 12, color: '#8c8c8c' }}>{t('rate')}</span>
                    <Rate style={{ fontSize: 16 }} onChange={async (v) => {
                      await selfApi.rateWorkOrder(w.id, v);
                      message.success(t('success'));
                      load();
                    }} />
                  </Space>
                )}
              </div>
            )}
          </div>
        ))}

      <Modal
        open={open} title={t('reportRepair')} onCancel={() => setOpen(false)}
        onOk={submit} confirmLoading={saving} okText={t('submit')}
        styles={{ body: { paddingTop: 8 } }}
      >
        <Space direction="vertical" style={{ width: '100%' }} size={14}>
          <div>
            <div style={{ fontSize: 13, color: '#595959', marginBottom: 6 }}>{t('repairCategory')}</div>
            <Select
              size="large" style={{ width: '100%' }} value={form.categoryId}
              onChange={(v) => setForm((f) => ({ ...f, categoryId: v }))}
              options={cats.map((c) => ({ value: c.id, label: `${dict(c)}（${c.slaHours}h）` }))}
            />
          </div>
          <div>
            <div style={{ fontSize: 13, color: '#595959', marginBottom: 6 }}>{t('repairTitle')}</div>
            <Input size="large" value={form.title} placeholder={t('repairTitleHint')}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
          </div>
          <div>
            <div style={{ fontSize: 13, color: '#595959', marginBottom: 6 }}>{t('repairDesc')}</div>
            <Input.TextArea rows={3} value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
          </div>
        </Space>
      </Modal>
    </div>
  );
}

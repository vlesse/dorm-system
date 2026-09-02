import { useEffect, useState } from 'react';
import { Drawer, Input, Table, Tag, Space, Button, App, Alert, Empty, Typography } from 'antd';
import { api } from '../api';
import { useT } from '../i18n';

/**
 * 分配床位抽屉。
 * 两种入口：
 *  - 传 bedId：给这张床找人（床位图上点空床）
 *  - 传 personId：给这个人找床（人员列表上点分配），会调推荐接口按规则打分排序
 */
export default function AssignDrawer({
  bedId, personId, onClose, onDone,
}: {
  bedId?: number | null;
  personId?: number | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useT();
  const { message, modal } = App.useApp();
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<any[]>([]);
  const [cand, setCand] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  // 给床找人：搜未安排住宿的在职人员
  useEffect(() => {
    if (!bedId) return;
    setLoading(true);
    api.persons({ q, housed: 'false', employmentStatus: 'ACTIVE', pageSize: 20 })
      .then((r) => setRows(r.rows))
      .finally(() => setLoading(false));
  }, [bedId, q]);

  // 给人找床：调推荐
  useEffect(() => {
    if (!personId) return;
    setLoading(true);
    api.candidates(personId).then(setCand).finally(() => setLoading(false));
  }, [personId]);

  const doAssign = async (pid: number, bid: number, warnings?: any[]) => {
    const run = async (force: boolean) => {
      try {
        await api.assign({ personId: pid, bedId: bid, force });
        message.success('已分配');
        onDone();
      } catch (e: any) {
        if (e.status === 409 && e.body?.warnings) {
          modal.confirm({
            title: t('warnings'),
            width: 460,
            content: (
              <ul style={{ paddingLeft: 18, margin: '8px 0' }}>
                {e.body.warnings.map((w: any, i: number) => <li key={i}>{w.message}</li>)}
              </ul>
            ),
            okText: '仍然分配',
            cancelText: t('cancel'),
            onOk: () => run(true),
          });
        } else if (e.status === 400 && e.body?.blockers) {
          modal.error({
            title: '不满足硬性排宿规则',
            content: (
              <ul style={{ paddingLeft: 18 }}>
                {e.body.blockers.map((w: any, i: number) => <li key={i}>{w.message}</li>)}
              </ul>
            ),
          });
        } else {
          message.error(e.message);
        }
      }
    };
    await run(false);
  };

  return (
    <Drawer
      open={!!bedId || !!personId}
      width={personId ? 720 : 560}
      onClose={onClose}
      title={bedId ? '为这张床选人' : t('recommended')}
    >
      {bedId && (
        <Space direction="vertical" style={{ width: '100%' }}>
          <Input.Search placeholder={t('search')} allowClear onSearch={setQ} onChange={(e) => !e.target.value && setQ('')} />
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            只列出「在职 + 尚未安排住宿」的人员。分配时会自动跑一遍排宿规则。
          </Typography.Text>
          <Table
            size="small" rowKey="id" loading={loading} dataSource={rows} pagination={false}
            columns={[
              { title: t('name'), dataIndex: 'name', render: (v, r: any) => (
                  <span>{v} <Tag color={r.nationalityColor} style={{ marginInlineStart: 4 }}>{r.nationalityId}</Tag>
                    <br /><span style={{ fontSize: 11, color: '#8c8c8c' }}>{r.employeeNo}</span></span>
                ) },
              { title: t('department'), dataIndex: 'department', width: 120 },
              { title: t('positionLevel'), dataIndex: 'positionLevel', width: 90 },
              { title: t('shift'), dataIndex: 'shift', width: 80 },
              {
                title: '', width: 80,
                render: (_, r: any) => <Button size="small" type="primary" onClick={() => doAssign(r.id, bedId)}>{t('confirm')}</Button>,
              },
            ]}
          />
        </Space>
      )}

      {personId && cand && (
        <Space direction="vertical" style={{ width: '100%' }} size={12}>
          <Alert
            type="info"
            message={
              <span>
                <b>{cand.person.name}</b>（{cand.person.employeeNo}）·{' '}
                <Tag>{cand.person.nationalityId}</Tag>
                <Tag>{cand.person.gender === 'MALE' ? t('male') : t('female')}</Tag>
                <Tag>{cand.person.department}</Tag>
                <Tag>{cand.person.positionLevel}</Tag>
                {cand.person.shift && <Tag>{cand.person.shift}</Tag>}
              </span>
            }
            description={`按当前排宿规则匹配到 ${cand.totalMatched} 间可用房间，下面按契合度排序。`}
          />
          {cand.currentBed && (
            <Alert type="warning" showIcon message={`该人员当前已住 ${cand.currentBed.roomCode} ${cand.currentBed.bedCode}，下面的操作会走「调宿」`} />
          )}
          {cand.candidates.length === 0 ? (
            <Empty description="没有满足硬性规则的可用床位" />
          ) : (
            <Table
              size="small" rowKey={(r: any) => r.room.id} dataSource={cand.candidates} loading={loading}
              pagination={{ pageSize: 8, size: 'small' }}
              columns={[
                { title: '契合度', dataIndex: 'score', width: 80,
                  render: (v) => <Tag color={v >= 120 ? 'green' : v >= 100 ? 'blue' : 'default'}>{v}</Tag> },
                { title: t('room'), width: 200, render: (_, r: any) => (
                    <span>
                      <b>{r.room.code}</b>{' '}
                      <Tag color={r.room.roomType.color} style={{ fontSize: 10 }}>{r.room.roomType.nameZh}</Tag>
                      <br />
                      <span style={{ fontSize: 11, color: '#8c8c8c' }}>
                        {r.room.floor?.buildingCode}栋 {r.room.floor?.level}F ·{' '}
                        在住 {r.room.beds.filter((b: any) => b.occupancy).length}/{r.room.capacity}
                      </span>
                    </span>
                  ) },
                { title: t('warnings'), render: (_, r: any) =>
                    r.warnings.length === 0
                      ? <Tag color="green">无提醒</Tag>
                      : <Space direction="vertical" size={0}>
                          {r.warnings.map((w: any, i: number) => (
                            <span key={i} style={{ fontSize: 11, color: '#d46b08' }}>· {w.message}</span>
                          ))}
                        </Space>
                },
                {
                  title: '', width: 90,
                  render: (_, r: any) => (
                    <Button size="small" type="primary" onClick={async () => {
                      const bid = r.freeBedIds[0];
                      if (cand.currentBed) {
                        try {
                          await api.transfer({ personId, toBedId: bid, force: true, reason: '宿管调宿' });
                          message.success('已调宿'); onDone();
                        } catch (e: any) { message.error(e.message); }
                      } else {
                        doAssign(personId, bid, r.warnings);
                      }
                    }}>
                      {cand.currentBed ? t('transfer') : t('assign')}
                    </Button>
                  ),
                },
              ]}
            />
          )}
        </Space>
      )}
    </Drawer>
  );
}

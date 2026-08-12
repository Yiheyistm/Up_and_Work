"""add chat session summary and updated_at

Revision ID: 6e00b9fb0d51
Revises: 15c420f127c6
Create Date: 2026-08-07 20:04:18.781516

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '6e00b9fb0d51'
down_revision: Union[str, Sequence[str], None] = '15c420f127c6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('chat_sessions', sa.Column('summary', sa.Text(), nullable=True))
    op.add_column('chat_sessions', sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('chat_sessions', 'updated_at')
    op.drop_column('chat_sessions', 'summary')

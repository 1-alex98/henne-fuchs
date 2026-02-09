import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';

import { SelectMode } from './select-mode';

describe('SelectMode', () => {
  let component: SelectMode;
  let fixture: ComponentFixture<SelectMode>;

  async function setup(code: string | null) {
    TestBed.resetTestingModule();

    await TestBed.configureTestingModule({
      imports: [SelectMode],
      providers: [
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              queryParamMap: {
                get: (k: string) => (k === 'code' ? code : null),
              },
            },
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(SelectMode);
    component = fixture.componentInstance;
    await fixture.whenStable();
  }

  beforeEach(async () => {
    await setup(null);
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('deep-links to online join when code query param is present', async () => {
    await setup('abc');
    expect(component.step()).toBe('online-join');
    expect(component.joinCode()).toBe('abc');
  });

  it('ignores empty/whitespace code query params', async () => {
    await setup('   ');
    expect(component.step()).toBe('mode');
    expect(component.joinCode()).toBe('');
  });

  it('shareLink uses native share sheet when available', async () => {
    // Arrange
    (component as any).peerConnection.state = () => ({ myPeerId: 'abc', status: 'idle' });

    const shareMock = (globalThis as any).vi.fn().mockResolvedValue(undefined);
    (navigator as any).share = shareMock;
    (navigator as any).canShare = () => true;

    // Act
    await (component as any).shareLink();

    // Assert
    expect(shareMock).toHaveBeenCalled();
  });

  it('shareLink falls back to clipboard when share is not available', async () => {
    // Arrange
    (component as any).peerConnection.state = () => ({ myPeerId: 'abc', status: 'idle' });

    (navigator as any).share = undefined;
    (navigator as any).canShare = undefined;

    const writeTextMock = (globalThis as any).vi.fn().mockResolvedValue(undefined);
    (navigator as any).clipboard = { writeText: writeTextMock };

    // Act
    await (component as any).shareLink();

    // Assert
    expect(writeTextMock).toHaveBeenCalled();
  });
});
